import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import express from 'express';
import QRCode  from 'qrcode';
import pino    from 'pino';
import { rmSync, existsSync } from 'fs';

const app      = express();
const PORT     = process.env.PORT                || 3000;
const WORKER   = process.env.WORKER              || 'https://chat.hostweb.workers.dev';
const SECRET   = process.env.SECRET              || 'ba_secret_2026';
const OWNER    = process.env.OWNER_UID           || '';
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const AUTH_DIR = './auth';

// ── CORS manual — permite x-secret desde cualquier origen ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-secret, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json());

let sock    = null;
let qrB64   = null;
let isReady = false;
const convs = {};

function clearSession() {
  try {
    if (existsSync(AUTH_DIR)) rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log('🗑 Sesión limpiada');
  } catch(e) { console.error('clearSession:', e.message); }
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
      getMessage:        async () => ({ conversation: '' })
    });

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        qrB64   = await QRCode.toDataURL(qr);
        isReady = false;
        console.log('📱 QR listo');
      }
      if (connection === 'open') {
        isReady = true;
        qrB64   = null;
        console.log('🔥 CONECTADO REALMENTE A WHATSAPP');
        }
      if (connection === 'close') {
        isReady = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log('❌ Desconectado, código:', code);
        if (code === DisconnectReason.loggedOut || code === 401 || code === 515) {
          clearSession();
        }
        setTimeout(startWA, 3000);
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!jid) continue;

        // ✅ BLOQUEAR GRUPOS — solo chats privados
        if (!jid.endsWith('@s.whatsapp.net')) {
          console.log('⛔ Grupo ignorado:', jid);
          continue;
        }

        const phone = jid.replace('@s.whatsapp.net', '');

        const text =
          msg.message?.conversation                    ||
          msg.message?.extendedTextMessage?.text       ||
          msg.message?.imageMessage?.caption           ||
          msg.message?.videoMessage?.caption           || '';

        if (!text.trim()) continue;

        console.log(`📩 ${phone}: ${text.substring(0, 80)}`);

        if (!convs[phone]) convs[phone] = [];
        convs[phone].push({
          role: 'user', text,
          time: new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
        });

        // Llamar Worker para respuesta IA
        try {
          const res = await fetch(`${WORKER}/wa`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-secret': SECRET },
            body:    JSON.stringify({ from: phone, text, token: OWNER })
          });

          if (!res.ok) {
            console.error('Worker status:', res.status);
            continue;
          }

          const data  = await res.json();
          const reply = data.reply || '';

          if (reply) {
            await sock.sendMessage(jid, { text: reply });
            convs[phone].push({
              role: 'assistant', text: reply,
              time: new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
            });
            console.log(`🤖 → ${phone}: ${reply.substring(0, 60)}`);
          }

        } catch(e) {
          console.error('Worker error:', e.message);
        }
      }
    });

  } catch(e) {
    console.error('startWA error:', e.message);
    setTimeout(startWA, 5000);
  }
}

// ── RUTAS ─────────────────────────────────────────

app.get('/', (_, res) => res.json({
  service: 'BA WhatsApp Bridge',
  status:  isReady ? 'connected' : 'disconnected',
  worker:  WORKER
}));

app.get('/status', (_, res) => res.json({
  ok: true, ready: isReady, hasQR: !!qrB64,
  convs: Object.keys(convs).length
}));

app.get('/qr', (_, res) => {
  if (isReady) return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff">
    <h2 style="color:#4ade80">✅ WhatsApp Conectado</h2>
    <p style="color:#9898b0">El bot está activo y solo responde chats privados.</p>
    <script>setTimeout(()=>location.reload(),10000)</script></body></html>`);
  if (!qrB64) return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff">
    <h2>⏳ Generando QR...</h2>
    <script>setTimeout(()=>location.reload(),3000)</script></body></html>`);
  res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0f;color:#fff">
    <h2 style="color:#25d366">📱 Escanea con WhatsApp</h2>
    <p style="color:#ef4444;font-weight:700">⚠️ Usa un número DIFERENTE al de tu celular principal</p>
    <p style="color:#9898b0">WhatsApp → ⋮ → Dispositivos vinculados → Vincular dispositivo</p>
    <img src="${qrB64}" style="width:280px;border-radius:16px;margin:20px 0;border:4px solid #25d366">
    <p style="color:#6b6b85;font-size:12px">Se actualiza automáticamente cada 25s</p>
    <script>setTimeout(()=>location.reload(),10000)</script></body></html>`);
});

app.post('/reset', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  isReady = false; qrB64 = null;
  if (sock) { try { sock.end(); } catch(e) {} sock = null; }
  clearSession();
  setTimeout(startWA, 1000);
  res.json({ ok:true, message:'Sesión limpiada — escanea /qr con número diferente al principal' });
});

app.get('/conversations', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  const list = Object.entries(convs)
    .map(([phone, msgs]) => ({
      phone,
      msgCount: msgs.length,
      lastMsg:  msgs[msgs.length-1]?.text?.substring(0, 80) || '',
      lastTime: msgs[msgs.length-1]?.time || ''
    }))
    .sort((a, b) => b.lastTime.localeCompare(a.lastTime));
  res.json({ ok:true, conversations: list });
});

app.get('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  res.json({ ok:true, msgs: convs[req.params.phone] || [] });
});

app.post('/send', async (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).json({ error:'phone y text requeridos' });
  if (!isReady)        return res.status(503).json({ error:'WhatsApp no conectado' });
  try {
    // Limpiar número — solo dígitos
    const cleanPhone = phone.replace(/\D/g, '');
    const jid        = `${cleanPhone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });
    if (!convs[cleanPhone]) convs[cleanPhone] = [];
    convs[cleanPhone].push({
      role: 'human', text,
      time: new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
    });
    console.log(`👤 Humano → ${cleanPhone}: ${text.substring(0,60)}`);
    res.json({ ok:true });
  } catch(e) {
    console.error('send error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  delete convs[req.params.phone];
  res.json({ ok:true });
});

// Keep-alive para Render Free
setInterval(() => {
  fetch(`${SELF_URL}/status`).catch(() => {});
}, 14 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 Puerto ${PORT} | Worker: ${WORKER}`);
  startWA();
});