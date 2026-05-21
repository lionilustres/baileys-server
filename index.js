import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import express  from 'express';
import cors     from 'cors';
import QRCode   from 'qrcode';
import pino     from 'pino';
import { rmSync, existsSync } from 'fs';

const app      = express();
const PORT     = process.env.PORT   || 3000;
const WORKER = process.env.WORKER || 'https://chat.hostweb.workers.dev';
const SECRET   = process.env.SECRET || 'ba_secret_2026';
const AUTH_DIR = './auth';

app.use(cors());
app.use(express.json());

let sock    = null;
let qrB64   = null;
let isReady = false;
const convs = {};

function clearSession() {
  try {
    if (existsSync(AUTH_DIR)) rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log('🗑 Sesión limpiada');
  } catch(e) { console.error('clearSession error:', e.message); }
}

async function startWA() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version }          = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth:              state,
      logger:            pino({ level: 'silent' }),
      printQRInTerminal: false,
      getMessage: async () => ({ conversation: '' }) // fix Bad MAC
    });

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        qrB64   = await QRCode.toDataURL(qr);
        isReady = false;
        console.log('📱 QR listo — ve a /qr');
      }
      if (connection === 'open') {
        isReady = true;
        qrB64   = null;
        console.log('✅ WhatsApp conectado');
      }
      if (connection === 'close') {
        isReady = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log('❌ Desconectado, código:', code);
        if (code === DisconnectReason.loggedOut) clearSession();
        setTimeout(startWA, 3000);
      }
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async (event) => {

  if (event.type !== 'notify') return;

  for (const msg of event.messages) {

    // 🔍 DEBUG REAL
    console.log("🧪 RAW MSG:", JSON.stringify(msg, null, 2));

    if (!msg.message || msg.key.fromMe) continue;

    const jid = msg.key.remoteJid;
    if (!jid) continue;

    const phone = jid.replace('@s.whatsapp.net', '');

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.buttonsResponseMessage?.selectedButtonId ||
      msg.message?.listResponseMessage?.title ||
      '';

    if (!text) continue;

    console.log("📩 WA:", phone, text);

    // ✅ guardar
    if (!convs[phone]) convs[phone] = [];

    convs[phone].push({
      role: 'user',
      text,
      time: new Date().toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit'
      })
    });

    console.log("📦 CONVS:", convs);

    // 🔁 worker
    try {
      const res = await fetch(`${WORKER}/wa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-secret': SECRET
        },
        body: JSON.stringify({ from: phone, text })
      });

      const data = await res.json();

      if (data.reply) {

        await sock.sendMessage(jid, { text: data.reply });

        convs[phone].push({
          role: 'assistant',
          text: data.reply,
          time: new Date().toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit'
          })
        });

      }

    } catch (e) {
      console.error("Worker error:", e.message);
    }
  }
});

     } catch(e) {
    console.error('startWA error:', e.message);
    setTimeout(startWA, 5000);
  }
}



// ── RUTAS ─────────────────────────────────────────

app.get('/', (_, res) => res.json({ service:'BA WhatsApp Bridge', status: isReady?'connected':'disconnected' }));

app.get('/status', (_, res) => res.json({ ok:true, ready:isReady, hasQR:!!qrB64, convs:Object.keys(convs).length }));

app.get('/qr', (_, res) => {
  if (isReady) return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff">
    <h2 style="color:#4ade80">✅ WhatsApp Conectado</h2><p style="color:#9898b0">El bot está activo.</p>
    <script>setTimeout(()=>location.reload(),10000)</script></body></html>`);
  if (!qrB64) return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff">
    <h2>⏳ Generando QR...</h2><script>setTimeout(()=>location.reload(),3000)</script></body></html>`);
  res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0f;color:#fff">
    <h2 style="color:#5328ff">📱 Escanea con WhatsApp</h2>
    <p style="color:#9898b0">WhatsApp → ⋮ → Dispositivos vinculados → Vincular dispositivo</p>
    <img src="${qrB64}" style="width:260px;border-radius:16px;margin:20px 0;border:4px solid #5328ff">
    <p style="color:#6b6b85;font-size:12px">Se actualiza automáticamente</p>
    <script>setTimeout(()=>location.reload(),25000)</script></body></html>`);
});

// RESET — limpia sesión corrupta
app.post('/reset', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  console.log('🔄 Reset solicitado');
  isReady = false; qrB64 = null;
  if (sock) { try { sock.end(); } catch(e) {} sock = null; }
  clearSession();
  setTimeout(startWA, 1000);
  res.json({ ok:true, message:'Sesión limpiada — escanea el QR en /qr' });
});

app.get('/conversations', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  const list = Object.entries(convs).map(([phone, msgs]) => ({
    phone, msgCount: msgs.length,
    lastMsg:  msgs[msgs.length-1]?.text?.substring(0,80) || '',
    lastTime: msgs[msgs.length-1]?.time || ''
  }));
  res.json({ ok:true, conversations:list });
});

app.get('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  res.json({ ok:true, msgs: convs[req.params.phone] || [] });
});

app.post('/send', async (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });

  const { phone, text } = req.body;

  const cleanPhone = phone.replace(/\D/g, '');

  if (!cleanPhone || !text) {
    return res.status(400).json({ error:'phone y text requeridos' });
  }

  if (!isReady) {
    return res.status(503).json({ error:'WhatsApp no conectado' });
  }

  try {
    const jid = `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text });

    if (!convs[cleanPhone]) convs[cleanPhone] = [];

    convs[cleanPhone].push({
      role:'human',
      text,
      time: new Date().toLocaleTimeString('es-CO',{
        hour:'2-digit',
        minute:'2-digit'
      })
    });

    res.json({ ok:true });

  } catch(e) {
    res.status(500).json({ error:e.message });
  }

}); 

app.delete('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  delete convs[req.params.phone];
  res.json({ ok:true });
});

// Mantener despierto — ping cada 14 minutos
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  fetch(`${RENDER_URL}/status`).catch(() => {});
}, 14 * 60 * 1000);

app.listen(PORT, () => { console.log(`🚀 Puerto ${PORT}`); startWA(); });