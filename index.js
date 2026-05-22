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
const WORKER   = process.env.WORKER || 'https://chat.hostweb.workers.dev';
const SECRET   = process.env.SECRET || 'ba_secret_2026';
const AUTH_DIR = './auth';

app.use(cors());
app.use(express.json());

let sock    = null;
let qrB64   = null;
let isReady = false;
const convs = {};

// 🔥 NORMALIZADOR (CLAVE)
function normalizePhone(phone){
  return phone.replace(/\D/g, '');
}

function clearSession() {
  if (existsSync(AUTH_DIR)) rmSync(AUTH_DIR, { recursive: true, force: true });
}

// ───────── WHATSAPP ─────────
async function startWA() {

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: '' })
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

    if (qr) {
      qrB64 = await QRCode.toDataURL(qr);
      isReady = false;
      console.log('📱 QR listo /qr');
    }

    if (connection === 'open') {
      isReady = true;
      qrB64 = null;
      console.log('✅ WhatsApp conectado');
    }

    if (connection === 'close') {
      isReady = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ Desconectado:', code);

      if (code === DisconnectReason.loggedOut) clearSession();
      setTimeout(startWA, 3000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ───────── MENSAJES ─────────
  sock.ev.on('messages.upsert', async (event) => {

    if (event.type !== 'notify') return;

    for (const msg of event.messages) {

      if (!msg.message) continue;

      const jid = msg.key.remoteJid;
      if (!jid) continue;

      const isFromMe = msg.key.fromMe;
      const phone = normalizePhone(jid);

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '';

      if (!text) continue;

      console.log("📩 WA:", phone, text);

      if (!convs[phone]) convs[phone] = [];

      convs[phone].push({
        role: isFromMe ? 'human' : 'user',
        text,
        time: new Date().toLocaleTimeString('es-CO')
      });

      // 🚫 NO IA SI ES TUYO
      if (isFromMe) continue;

      // 🤖 IA
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
            time: new Date().toLocaleTimeString('es-CO')
          });
        }

      } catch (e) {
        console.error("Worker error:", e.message);
      }
    }
  });
}

// ───────── RUTAS ─────────

app.get('/status', (_, res) => {
  res.json({ ok:true, ready:isReady, hasQR:!!qrB64, convs:Object.keys(convs).length });
});

// QR (NO SE TOCÓ)
app.get('/qr', (_, res) => {
  if (isReady) return res.send(`<html><body style="background:#0a0a0f;color:#fff;text-align:center;padding:60px"><h2 style="color:#4ade80">✅ Conectado</h2></body></html>`);
  if (!qrB64) return res.send(`<html><body style="background:#0a0a0f;color:#fff;text-align:center;padding:60px"><h2>⏳ Generando QR...</h2></body></html>`);
  res.send(`<html><body style="background:#0a0a0f;color:#fff;text-align:center;padding:40px">
    <h2>📱 Escanea</h2>
    <img src="${qrB64}" style="width:260px;border-radius:16px">
  </body></html>`);
});

// conversaciones
app.get('/conversations', (req, res) => {
  const list = Object.entries(convs).map(([phone, msgs]) => ({
    phone,
    lastMsg: msgs[msgs.length-1]?.text || ''
  }));
  res.json({ conversations:list });
});

app.get('/conversations/:phone', (req, res) => {
  const phone = normalizePhone(req.params.phone);
  res.json({ msgs: convs[phone] || [] });
});

// 🔥 SEND (CLAVE)
app.post('/send', async (req, res) => {

  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });

  const { phone, text } = req.body;
  const cleanPhone = normalizePhone(phone);

  if (!cleanPhone || !text) return res.status(400).json({ error:'phone y text requeridos' });
  if (!isReady) return res.status(503).json({ error:'WhatsApp no conectado' });

  try {

    const jid = `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text });

    if (!convs[cleanPhone]) convs[cleanPhone] = [];

    convs[cleanPhone].push({
      role:'human',
      text,
      time: new Date().toLocaleTimeString('es-CO')
    });

    res.json({ ok:true });

  } catch(e){
    res.status(500).json({ error:e.message });
  }
});

// KEEP ALIVE (NO QUITAR)
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  fetch(`${RENDER_URL}/status`).catch(() => {});
}, 14 * 60 * 1000);

// START (NO QUITAR)
app.listen(PORT, () => {
  console.log(`🚀 Puerto ${PORT}`);
  startWA();
});