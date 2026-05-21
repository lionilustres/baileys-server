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


// ───────── NORMALIZADOR ─────────
function normalizePhone(phone) {
  return phone.toString().replace(/\D/g, '');
}


// ───────── LIMPIAR SESIÓN ─────────
function clearSession() {
  try {
    if (existsSync(AUTH_DIR)) {
      rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    console.log('🗑 sesión eliminada');
  } catch (e) {
    console.error(e);
  }
}


// ───────── INICIAR WHATSAPP ─────────
async function startWA() {
  try {

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version }          = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      getMessage: async () => ({ conversation: '' })
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
        console.log('✅ conectado');
      }

      if (connection === 'close') {
        isReady = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log('❌ desconectado', code);

        if (code === DisconnectReason.loggedOut) {
          clearSession();
        }

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

        const phone    = normalizePhone(jid);
        const isFromMe = msg.key.fromMe;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          '';

        if (!text) continue;

        // ─── GUARDAR ───
        if (!convs[phone]) convs[phone] = [];

        convs[phone].push({
          role: isFromMe ? 'human' : 'user',
          text,
          time: new Date().toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit'
          })
        });

        console.log('📩', phone, text);

        // 🔥 NO RESPONDER SI ERES TÚ
        if (isFromMe) continue;


        // ─── IA ───
        try {

          const res = await fetch(`${WORKER}/wa`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-secret': SECRET
            },
            body: JSON.stringify({
              from: phone,
              text
            })
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
          console.error('IA error:', e.message);
        }

      }

    });

  } catch (e) {
    console.error('start error:', e.message);
    setTimeout(startWA, 5000);
  }
}


// ───────── RUTAS ─────────

app.get('/status', (_, res) => {
  res.json({
    ok: true,
    ready: isReady,
    convs: Object.keys(convs).length
  });
});


app.get('/qr', (_, res) => {
  if (isReady) return res.send('YA CONECTADO');

  if (!qrB64) {
    return res.send('GENERANDO QR...');
  }

  res.send(`<img src="${qrB64}" width="300">`);
});


app.get('/conversations', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const list = Object.entries(convs).map(([phone, msgs]) => ({
    phone,
    lastMsg: msgs[msgs.length - 1]?.text || '',
    lastTime: msgs[msgs.length - 1]?.time || ''
  }));

  res.json({ conversations: list });
});


app.get('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const phone = normalizePhone(req.params.phone);
  res.json({ msgs: convs[phone] || [] });
});


// ───────── ENVÍO DESDE DASHBOARD ─────────
app.post('/send', async (req, res) => {

  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { phone, text } = req.body;

  const cleanPhone = normalizePhone(phone);

  if (!cleanPhone || !text) {
    return res.status(400).json({ error: 'datos inválidos' });
  }

  if (!isReady) {
    return res.status(503).json({ error: 'whatsapp no conectado' });
  }

  try {

    const jid = `${cleanPhone}@s.whatsapp.net`;

    console.log('📤 enviando a:', jid);

    await sock.sendMessage(jid, { text });

    if (!convs[cleanPhone]) convs[cleanPhone] = [];

    convs[cleanPhone].push({
      role: 'human',
      text,
      time: new Date().toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit'
      })
    });

    res.json({ ok: true });

  } catch (e) {
    console.error('send error:', e.message);
    res.status(500).json({ error: e.message });
  }

});


// ───────── RESET ─────────
app.post('/reset', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).end();
  }

  clearSession();
  res.json({ ok: true });
});


// ───────── START ─────────
app.listen(PORT, () => {
  console.log('🚀 server activo');
  startWA();
});