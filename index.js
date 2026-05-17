import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import express  from 'express';
import cors     from 'cors';
import QRCode   from 'qrcode';
import pino     from 'pino';

const app    = express();
const PORT   = process.env.PORT   || 3000;
const WORKER = process.env.WORKER || 'https://chat.hostweb.workers.dev';
const SECRET = process.env.SECRET || 'ba_secret_2026';

app.use(cors());
app.use(express.json());

// Estado global
let sock     = null;
let qrB64    = null;
let isReady  = false;

// Conversaciones en memoria: { phone: [{role, text, time}] }
const convs = {};

// ── Iniciar Baileys ──────────────────────────────
async function startWA() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth:   state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrB64   = await QRCode.toDataURL(qr);
      isReady = false;
      console.log('QR generado');
    }
    if (connection === 'open') {
      isReady = true;
      qrB64   = null;
      console.log('✅ WhatsApp conectado');
    }
    if (connection === 'close') {
      isReady = false;
      const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (reconnect) setTimeout(startWA, 3000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Mensaje entrante
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      const text = msg.message?.conversation
                || msg.message?.extendedTextMessage?.text
                || '';
      if (!text) continue;

      const phone = from.replace('@s.whatsapp.net', '');
      if (!convs[phone]) convs[phone] = [];

      // Guardar mensaje del cliente
      convs[phone].push({
        role: 'user', text,
        time: new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
      });

      console.log(`📨 ${phone}: ${text}`);

      // Pedir respuesta al Worker
      try {
        const res  = await fetch(`${WORKER}/wa`, {
          method:  'POST',
          headers: { 'Content-Type':'application/json', 'x-secret': SECRET },
          body:    JSON.stringify({ from: phone, text })
        });
        const data  = await res.json();
        const reply = data.reply || '';
        if (reply) {
          await sock.sendMessage(from, { text: reply });
          convs[phone].push({
            role: 'assistant', text: reply,
            time: new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
          });
        }
      } catch(e) {
        console.error('Worker error:', e.message);
      }
    }
  });
}

// ── RUTAS ────────────────────────────────────────

// Health check
app.get('/', (_, res) => res.json({
  service: 'BA WhatsApp Bridge',
  status:  isReady ? 'connected' : 'disconnected'
}));

// Estado
app.get('/status', (_, res) => res.json({
  ok: true, ready: isReady, hasQR: !!qrB64,
  convs: Object.keys(convs).length
}));

// Página QR
app.get('/qr', (_, res) => {
  if (isReady) return res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff">
      <h2 style="color:#4ade80">✅ WhatsApp Conectado</h2>
      <p style="color:#9898b0">El bot está activo.</p>
    </body></html>`);

  if (!qrB64) return res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff">
      <h2>⏳ Generando QR...</h2>
      <script>setTimeout(()=>location.reload(),3000)</script>
    </body></html>`);

  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0f;color:#fff">
      <h2 style="color:#5328ff">📱 Escanea con WhatsApp</h2>
      <p style="color:#9898b0">WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
      <img src="${qrB64}" style="width:260px;border-radius:16px;margin:20px 0;border:4px solid #5328ff">
      <p style="color:#6b6b85;font-size:12px">Se actualiza automáticamente</p>
      <script>setTimeout(()=>location.reload(),25000)</script>
    </body></html>`);
});

// Listar conversaciones
app.get('/conversations', (req, res) => {
  if (req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  const list = Object.entries(convs).map(([phone, msgs]) => ({
    phone,
    msgCount: msgs.length,
    lastMsg:  msgs[msgs.length-1]?.text?.substring(0,80) || '',
    lastTime: msgs[msgs.length-1]?.time || ''
  }));

  res.json({ ok: true, conversations: list });
});

// Mensajes de una conversación
app.get('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  res.json({ ok: true, msgs: convs[req.params.phone] || [] });
});

// Enviar mensaje manual (humano)
app.post('/send', async (req, res) => {
  if (req.headers['x-secret'] !== SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  const { phone, text } = req.body;
  if (!phone || !text)  return res.status(400).json({ error: 'phone y text requeridos' });
  if (!isReady)         return res.status(503).json({ error: 'WhatsApp no conectado' });

  try {
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });

    if (!convs[phone]) convs[phone] = [];
    convs[phone].push({
      role: 'human', text,
      time: new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
    });

    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Arrancar ──────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Puerto ${PORT}`);
  startWA();
});