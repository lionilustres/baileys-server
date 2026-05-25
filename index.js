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
const OWNER    = process.env.OWNER_UID           || 'KsdcPgU2sRcBJ2IZRpahNueKzdN2';
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const AUTH_DIR = './auth';

<<<<<<< HEAD
<<<<<<< HEAD
app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-secret']
}));
<<<<<<< HEAD
=======
=======
>>>>>>> parent of cd59ae7 (restore)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-secret, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
<<<<<<< HEAD
>>>>>>> parent of cd59ae7 (restore)
=======
>>>>>>> parent of cd59ae7 (restore)
=======
app.options('*', cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-secret', 'x-uid']
}));
>>>>>>> parent of 4b15127 (56564778788)
app.use(express.json());

let sock    = null;
let qrB64   = null;
let isReady = false;
const convs = {};

function clearSession() {
  try {
    if (existsSync(AUTH_DIR)) rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log('Sesion limpiada');
  } catch(e) { console.error('clearSession:', e.message); }
}

async function startWA() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version }          = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version, auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      getMessage: async () => ({ conversation: '' })
    });

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) { qrB64 = await QRCode.toDataURL(qr); isReady = false; console.log('QR listo'); }
      if (connection === 'open') { isReady = true; qrB64 = null; console.log('WhatsApp conectado'); }
      if (connection === 'close') {
        isReady = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log('Desconectado codigo:', code);
        if (code === DisconnectReason.loggedOut || code === 401 || code === 515) clearSession();
        setTimeout(startWA, 3000);
      }
    });

    sock.ev.on('creds.update', saveCreds);

<<<<<<< HEAD
<<<<<<< HEAD
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

      // 🔥 UID
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

        if (!uid) {
          console.log("⛔ SIN UID → NO se guarda:", phone);
         }

      } catch (e) {
        console.error('UID resolve error:', e.message);
      }

    

      // 🔥 CREAR / ACTUALIZAR CONVERSACIÓN
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

      // ✅ GUARDAR USER
      convs[phone].msgs.push({
        role: 'user',
        text,
        time: new Date().toLocaleTimeString('es-CO', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });

      // 🔁 ENVIAR AL WORKER
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
          uid: uid || null
          })
        });

        data = await res.json();

      } catch (e) {
        console.error("Worker error:", e.message);
        continue;
      }

     // 🤖 RESPUESTA BOT
if (data?.reply && sock) {

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
=======
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          if (!msg.message || msg.key.fromMe) continue;
          const jid = msg.key.remoteJid;
          if (!jid || !jid.endsWith('@s.whatsapp.net')) continue;
          const phone = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
          if (!text.trim()) continue;
          console.log(`MSG ${phone}: ${text.substring(0,60)}`);
          if (!convs[phone]) convs[phone] = { jid, msgs: [] };
          convs[phone].jid = jid;
          convs[phone].msgs.push({ role:'user', text, time: new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) });
          const res  = await fetch(`${WORKER}/wa`, { method:'POST', headers:{'Content-Type':'application/json','x-secret':SECRET}, body: JSON.stringify({from:phone, text, token:OWNER}) });
          if (!res.ok) { console.error('Worker status:', res.status); continue; }
          const data  = await res.json();
          const reply = data.reply || '';
          if (reply) {
            await sock.sendMessage(jid, { text: reply });
            convs[phone].msgs.push({ role:'assistant', text:reply, time: new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) });
            console.log(`BOT ${phone}: ${reply.substring(0,60)}`);
          }
        } catch(e) { console.error('msg error:', e.message); }
      }
    });
  } catch(e) { console.error('startWA error:', e.message); setTimeout(startWA, 5000); }
}

app.get('/',        (_, res) => res.json({ service:'BA WhatsApp Bridge', status: isReady?'connected':'disconnected' }));
app.get('/status',  (_, res) => res.json({ ok:true, ready:isReady, hasQR:!!qrB64, convs:Object.keys(convs).length }));
>>>>>>> parent of cd59ae7 (restore)
=======
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          if (!msg.message || msg.key.fromMe) continue;
          const jid = msg.key.remoteJid;
          if (!jid || !jid.endsWith('@s.whatsapp.net')) continue;
          const phone = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
          if (!text.trim()) continue;
          console.log(`MSG ${phone}: ${text.substring(0,60)}`);
          if (!convs[phone]) convs[phone] = { jid, msgs: [] };
          convs[phone].jid = jid;
          convs[phone].msgs.push({ role:'user', text, time: new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) });
          const res  = await fetch(`${WORKER}/wa`, { method:'POST', headers:{'Content-Type':'application/json','x-secret':SECRET}, body: JSON.stringify({from:phone, text, token:OWNER}) });
          if (!res.ok) { console.error('Worker status:', res.status); continue; }
          const data  = await res.json();
          const reply = data.reply || '';
          if (reply) {
            await sock.sendMessage(jid, { text: reply });
            convs[phone].msgs.push({ role:'assistant', text:reply, time: new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) });
            console.log(`BOT ${phone}: ${reply.substring(0,60)}`);
          }
        } catch(e) { console.error('msg error:', e.message); }
      }
    });
  } catch(e) { console.error('startWA error:', e.message); setTimeout(startWA, 5000); }
}

app.get('/',        (_, res) => res.json({ service:'BA WhatsApp Bridge', status: isReady?'connected':'disconnected' }));
app.get('/status',  (_, res) => res.json({ ok:true, ready:isReady, hasQR:!!qrB64, convs:Object.keys(convs).length }));
>>>>>>> parent of cd59ae7 (restore)

app.get('/qr', (_, res) => {
  if (isReady) return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff"><h2 style="color:#4ade80">WhatsApp Conectado</h2><p style="color:#9898b0">Bot activo. Solo responde mensajes privados.</p><script>setTimeout(()=>location.reload(),10000)</script></body></html>`);
  if (!qrB64) return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#fff"><h2>Generando QR...</h2><script>setTimeout(()=>location.reload(),3000)</script></body></html>`);
  res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0f;color:#fff"><h2 style="color:#25d366">Escanea con WhatsApp</h2><p style="color:#ef4444;font-weight:700">USA UN NUMERO DIFERENTE AL DE TU CELULAR PRINCIPAL</p><p style="color:#9898b0">WhatsApp menu Dispositivos vinculados Vincular dispositivo</p><img src="${qrB64}" style="width:280px;border-radius:16px;margin:20px 0;border:4px solid #25d366"><script>setTimeout(()=>location.reload(),25000)</script></body></html>`);
});

app.post('/reset', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  isReady = false; qrB64 = null;
  if (sock) { try { sock.end(); } catch(e) {} sock = null; }
  clearSession();
  setTimeout(startWA, 1000);
  res.json({ ok:true, message:'Sesion limpiada' });
});

app.get('/conversations', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
<<<<<<< HEAD
<<<<<<< HEAD

<<<<<<< HEAD
  const list = Object.entries(convs).map(([phone, chat]) => ({
=======
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error:'Unauthorized' });
  }

  const uid = req.headers['x-uid'];

  if (!uid) {
    return res.json({ ok:true, conversations: [] });
  }

  const userConvs = convs[uid] || {};

  const list = Object.entries(userConvs).map(([phone, chat]) => ({
  phone,
  uid, // 🔥 ESTE ES EL FIX
  msgCount: chat.msgs.length,
  lastMsg: chat.msgs.slice(-1)[0]?.text || '',
  lastTime: chat.msgs.slice(-1)[0]?.time || ''
}));

  res.json({ ok:true, conversations:list });
});

app.get('/conversations', (req, res) => {

  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error:'Unauthorized' });
  }

  const uid = req.headers['x-uid'];

  if (!uid) {
    return res.json({ ok:true, conversations: [] });
  }

  const userConvs = convs[uid] || {};

  const list = Object.entries(userConvs).map(([phone, chat]) => ({
>>>>>>> parent of 4b15127 (56564778788)
    phone,
    uid: chat.uid, // 👈 FIX CLAVE
    msgCount: chat.msgs.length,
<<<<<<< HEAD
    lastMsg: chat.msgs[chat.msgs.length - 1]?.text?.substring(0, 80) || '',
    lastTime: chat.msgs[chat.msgs.length - 1]?.time || ''
=======
    lastMsg: chat.msgs.slice(-1)[0]?.text || '',
    lastTime: chat.msgs.slice(-1)[0]?.time || ''
>>>>>>> parent of 4b15127 (56564778788)
  }));

  res.json({ ok:true, conversations:list });
});

<<<<<<< HEAD
app.get('/conversations/:phone', (req, res) => {
=======

app.post('/send', async (req, res) => {

  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error:'Unauthorized' });
  }

  const uid = req.headers['x-uid'];
  const { phone, text } = req.body;

  if (!uid) {
    return res.status(400).json({ error:'uid requerido' });
  }

  if (!phone || !text) {
    return res.status(400).json({ error:'phone y text requeridos' });
  }

  if (!isReady) {
    return res.status(503).json({ error:'WhatsApp no conectado' });
  }

  try {

    const cleanPhone = phone.replace(/\D/g, '');

    const chat = convs?.[uid]?.[cleanPhone];

    if (!chat || !chat.jid) {
      return res.status(404).json({ error:'No existe conversación activa' });
    }

    await sock.sendMessage(chat.jid, { text });

    chat.msgs.push({
      role: 'human',
      text,
      time: new Date().toLocaleTimeString('es-CO', {
        hour:'2-digit',
        minute:'2-digit'
      })
    });

    res.json({ ok:true });

  } catch(e){
    console.error('send error:', e.message);
    res.status(500).json({ error:e.message });
  }
});

app.delete('/conversations/:phone', (req, res) => {

>>>>>>> parent of 4b15127 (56564778788)
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
=======
  const list = Object.entries(convs).map(([phone, chat]) => ({
    phone, msgCount: chat.msgs.length,
    lastMsg:  chat.msgs[chat.msgs.length-1]?.text?.substring(0,80) || '',
    lastTime: chat.msgs[chat.msgs.length-1]?.time || ''
  })).sort((a,b) => b.lastTime.localeCompare(a.lastTime));
  res.json({ ok:true, conversations: list });
});

app.get('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  const chat = convs[req.params.phone];
  res.json({ ok:true, msgs: chat?.msgs || [] });
});

app.post('/send', async (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).json({ error:'phone y text requeridos' });
  if (!isReady)        return res.status(503).json({ error:'WhatsApp no conectado' });
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const chat = convs[cleanPhone];
    const jid  = chat?.jid || `${cleanPhone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });
    if (!convs[cleanPhone]) convs[cleanPhone] = { jid, msgs: [] };
    convs[cleanPhone].msgs.push({ role:'human', text, time: new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) });
    console.log(`HUMANO ${cleanPhone}: ${text.substring(0,60)}`);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
>>>>>>> parent of cd59ae7 (restore)
=======
  const list = Object.entries(convs).map(([phone, chat]) => ({
    phone, msgCount: chat.msgs.length,
    lastMsg:  chat.msgs[chat.msgs.length-1]?.text?.substring(0,80) || '',
    lastTime: chat.msgs[chat.msgs.length-1]?.time || ''
  })).sort((a,b) => b.lastTime.localeCompare(a.lastTime));
  res.json({ ok:true, conversations: list });
});

app.get('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  const chat = convs[req.params.phone];
  res.json({ ok:true, msgs: chat?.msgs || [] });
});

app.post('/send', async (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).json({ error:'phone y text requeridos' });
  if (!isReady)        return res.status(503).json({ error:'WhatsApp no conectado' });
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const chat = convs[cleanPhone];
    const jid  = chat?.jid || `${cleanPhone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });
    if (!convs[cleanPhone]) convs[cleanPhone] = { jid, msgs: [] };
    convs[cleanPhone].msgs.push({ role:'human', text, time: new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) });
    console.log(`HUMANO ${cleanPhone}: ${text.substring(0,60)}`);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
>>>>>>> parent of cd59ae7 (restore)
});

app.delete('/conversations/:phone', (req, res) => {
  if (req.headers['x-secret'] !== SECRET) return res.status(401).json({ error:'Unauthorized' });
  delete convs[req.params.phone];
  res.json({ ok:true });
});

<<<<<<< HEAD
<<<<<<< HEAD
// Mantener despierto — ping cada 14 minutos
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  fetch(`${RENDER_URL}/status`).catch(() => {});
}, 14 * 60 * 1000);

app.listen(PORT, () => { console.log(`🚀 Puerto ${PORT}`); startWA(); });
=======
=======
>>>>>>> parent of cd59ae7 (restore)
setInterval(() => fetch(`${SELF_URL}/status`).catch(()=>{}), 14*60*1000);
app.listen(PORT, () => { console.log(`Puerto ${PORT} | Worker: ${WORKER} | Owner: ${OWNER}`); startWA(); });

>>>>>>> parent of cd59ae7 (restore)
