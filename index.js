import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import pino from 'pino';
import { rmSync, existsSync } from 'fs';

const app = express();
const PORT = 3000;
const AUTH_DIR = './auth';

// 🔴 SIN WORKER (para que funcione YA)
const SECRET = 'ba_secret_2026';

app.use(cors());
app.use(express.json());

let sock = null;
let qrB64 = null;
let isReady = false;

// 🔥 conversaciones reales
const convs = {};

// ───────────────────────────────
function clearSession() {
  if (existsSync(AUTH_DIR)) {
    rmSync(AUTH_DIR, { recursive: true, force: true });
  }
}

// ───────────────────────────────
async function startWA() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('connection.update', async ({ connection, qr }) => {
    if (qr) {
      qrB64 = await QRCode.toDataURL(qr);
      isReady = false;
      console.log('📱 QR listo');
    }

    if (connection === 'open') {
      isReady = true;
      qrB64 = null;
      console.log('✅ WA conectado');
    }

    if (connection === 'close') {
      isReady = false;
      setTimeout(startWA, 3000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // 🔥 MENSAJES
  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages) return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid || jid.includes('@g.us')) continue;

      const phone = jid.split('@')[0];

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!text) continue;

      console.log('📩', phone, text);

      // 🔥 guardar
      if (!convs[phone]) {
        convs[phone] = { jid, msgs: [] };
      }

      convs[phone].msgs.push({
        role: 'user',
        text
      });

      // 🔥 RESPUESTA DIRECTA (SIN WORKER)
      const reply = `🤖 Recibido: ${text}`;

      await sock.sendMessage(jid, { text: reply });

      convs[phone].msgs.push({
        role: 'assistant',
        text: reply
      });
    }
  });
}

// ───────────────────────────────
// RUTAS

app.get('/status', (_, res) => {
  res.json({
    ok: true,
    ready: isReady,
    convs: Object.keys(convs).length
  });
});

app.get('/qr', (_, res) => {
  if (isReady) return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff">
    <h2 style="color:#4ade80">✅ WhatsApp Conectado</h2><link rel="icon" href="https://businessasesores.web.app/wp-content/uploads/2022/03/wp-icon-1.png" sizes="32x32">
    <link rel="icon" href="https://businessasesores.web.app/wp-content/uploads/2022/03/wp-icon-1.png" sizes="192x192"><p style="color:#9898b0">El bot está activo.</p>
    <script>setTimeout(()=>location.reload(),10000)</script></body></html>`);
  if (!qrB64) return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff">
    <h2>⏳ Generando QR...</h2><script>setTimeout(()=>location.reload(),3000)</script></body></html>`);
  res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0f;color:#fff">
    <h2 style="color:#5328ff">📱 Escanea con WhatsApp</h2><link rel="icon" href="https://businessasesores.web.app/wp-content/uploads/2022/03/wp-icon-1.png" sizes="32x32">
    <link rel="icon" href="https://businessasesores.web.app/wp-content/uploads/2022/03/wp-icon-1.png" sizes="192x192">
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

app.get('/conversations', (_, res) => {
  const list = Object.entries(convs).map(([phone, c]) => ({
    phone,
    lastMsg: c.msgs.at(-1)?.text || ''
  }));
  res.json({ conversations: list });
});

app.get('/conversations/:phone', (req, res) => {
  const chat = convs[req.params.phone];
  res.json({ msgs: chat?.msgs || [] });
});

app.post('/send', async (req, res) => {
  const { phone, text } = req.body;

  if (!sock || !isReady) {
    return res.json({ error: 'WA no listo' });
  }

  const jid = `${phone}@s.whatsapp.net`;

  await sock.sendMessage(jid, { text });

  res.json({ ok: true });
});

// ───────────────────────────────
app.listen(PORT, () => {
  console.log('🚀 Server', PORT);
  startWA();
});

// Mantener despierto — ping cada 14 minutos
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  fetch(`${RENDER_URL}/status`).catch(() => {});
}, 14 * 60 * 1000);

app.listen(PORT, () => { console.log(`🚀 Puerto ${PORT}`); startWA(); });

