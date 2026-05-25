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

app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-secret']
}));
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

  if (!event.messages) return;

  for (const msg of event.messages) {

    try {

      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid) continue;

      // ⛔ BLOQUEAR GRUPOS
      if (jid.includes('@g.us')) continue;

      // 🔥 NORMALIZAR TELÉFONO
      const raw = jid.split('@')[0];
      const phone = raw.replace(/\D/g, '');

      let uid = convs[phone]?.uid || null;

try {
  const resUID = await fetch(`${WORKER}/resolve-uid`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-secret': SECRET
    },
    body: JSON.stringify({ phone })
  });

  const dataUID = await resUID.json();
  if (dataUID?.uid) uid = dataUID.uid;

} catch (e) {}

if (!uid) {
  console.log("⛔ SIN UID → BLOQUEADO:", phone);
  continue;
}

      } catch (e) {
        console.error('UID resolve error:', e.message);
      }

      // 🔥 CREAR O ACTUALIZAR CONVERSACIÓN (SIEMPRE CONSISTENTE)
      if (!convs[phone]) {
        convs[phone] = {
          jid,
          uid,
          msgs: []
        };
      } else {
        convs[phone].jid = jid;
        convs[phone].uid = uid;
      }

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '';

      if (!text) continue;

      console.log("📩 WA:", phone, text);

      // ✅ USER MSG
      convs[phone].msgs.push({
        role: 'user',
        text,
        time: new Date().toLocaleTimeString('es-CO', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });

      // 🔁 ENVIAR AL WORKER (con protección)
      let data = null;

      try {
        const res = await fetch(`${WORKER}/wa`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-secret': SECRET
          },
          body: JSON.stringify({
            from: phone,
            text,
            uid
          })
        });

        data = await res.json();

      } catch (e) {
        console.error("Worker error:", e.message);
        continue;
      }

      // 🤖 RESPUESTA BOT
      if (data?.reply && isReady && sock) {

        try {
          await sock.sendMessage(jid, { text: data.reply });

          convs[phone].msgs.push({
            role: 'assistant',
            text: data.reply,
            time: new Date().toLocaleTimeString('es-CO', {
              hour: '2-digit',
              minute: '2-digit'
            })
          });

        } catch (e) {
          console.error("Send error:", e.message);
        }
      }

    } catch (e) {
      console.error("messages.upsert fatal:", e.message);
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

app.get('/conversations', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });

  const list = Object.entries(convs).map(([phone, chat]) => ({
    phone,
    uid: chat.uid, // 👈 FIX CLAVE
    msgCount: chat.msgs.length,
    lastMsg: chat.msgs[chat.msgs.length - 1]?.text?.substring(0, 80) || '',
    lastTime: chat.msgs[chat.msgs.length - 1]?.time || ''
  }));

  res.json({ ok:true, conversations:list });
});

app.get('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error:'Unauthorized' });
  }

  const chat = convs[req.params.phone];

  res.json({
    ok: true,
    msgs: chat ? chat.msgs : []
  });
}); 


app.post('/send', async (req, res) => {
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error:'Unauthorized' });
  }

  const { phone, text } = req.body;

  if (!phone || !text) {
    return res.status(400).json({ error:'phone y text requeridos' });
  }

  if (!isReady) {
    return res.status(503).json({ error:'WhatsApp no conectado' });
  }

  try {
    const cleanPhone = phone.replace(/\D/g, '');

    // 🔥 BUSCAR CONVERSACIÓN REAL
    const chat = convs[cleanPhone];

    if (!chat || !chat.jid) {
      return res.status(404).json({ error:'No existe conversación activa con ese número' });
    }

    const jid = chat.jid; // 👈 ESTE ES EL FIX CLAVE

    await sock.sendMessage(jid, { text });

    // ✅ GUARDAR MENSAJE HUMANO
    chat.msgs.push({
      role: 'human',
      text,
      time: new Date().toLocaleTimeString('es-CO', {
        hour:'2-digit',
        minute:'2-digit'
      })
    });

    console.log(`👤 Humano → ${cleanPhone}: ${text}`);

    res.json({ ok:true });

  } catch(e) {
    console.error('send error:', e.message);
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