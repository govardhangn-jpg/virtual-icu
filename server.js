// ══════════════════════════════════════════════
//  VitalWatch Backend — Samarthaa Hospital
//  Handles: Calls, WhatsApp, SMS, Counselling AI
// ══════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const https   = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// ── Twilio ──
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER  = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

let client = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio connected');
} else {
  console.log('⚠️  Twilio not configured');
}

// ── Anthropic (Claude) ──
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (ANTHROPIC_API_KEY) {
  console.log('✅ Claude AI connected');
} else {
  console.log('⚠️  ANTHROPIC_API_KEY not set — counselling AI will not work');
}

// ════════════════════════════════
//  PHONE CALL
// ════════════════════════════════
app.post('/api/call', async (req, res) => {
  const { to, patient, message, hospital, ward } = req.body;
  if (!client) return res.json({ success:false, error:'Twilio not configured' });
  try {
    const call = await client.calls.create({
      to, from: TWILIO_PHONE_NUMBER,
      twiml: `<Response>
        <Say voice="Polly.Raveena" language="en-IN">
          Critical alert from ${hospital}. Patient ${patient}. ${message}. Please respond immediately to Ward ${ward}.
        </Say>
        <Pause length="1"/>
        <Say voice="Polly.Raveena" language="en-IN">
          Repeating. Patient ${patient}. ${message}. Please respond immediately.
        </Say>
      </Response>`
    });
    console.log('✅ Call:', call.sid);
    res.json({ success:true, callSid:call.sid });
  } catch (err) {
    console.error('❌ Call failed:', err.message);
    res.status(500).json({ success:false, error:err.message });
  }
});

// ════════════════════════════════
//  WHATSAPP
// ════════════════════════════════
app.post('/api/whatsapp', async (req, res) => {
  const { to, message } = req.body;
  if (!client) return res.json({ success:false, error:'Twilio not configured' });
  try {
    const formattedTo = 'whatsapp:' + (to.startsWith('+') ? to : '+' + to);
    const msg = await client.messages.create({ from:TWILIO_WHATSAPP_FROM, to:formattedTo, body:message });
    console.log('✅ WhatsApp:', msg.sid);
    res.json({ success:true, messageSid:msg.sid });
  } catch (err) {
    console.error('❌ WhatsApp failed:', err.message);
    res.status(500).json({ success:false, error:err.message });
  }
});

// ════════════════════════════════
//  SMS
// ════════════════════════════════
app.post('/api/sms', async (req, res) => {
  const { to, message } = req.body;
  if (!client) return res.json({ success:false, error:'Twilio not configured' });
  try {
    const msg = await client.messages.create({ from:TWILIO_PHONE_NUMBER, to, body:message });
    console.log('✅ SMS:', msg.sid);
    res.json({ success:true, messageSid:msg.sid });
  } catch (err) {
    console.error('❌ SMS failed:', err.message);
    res.status(500).json({ success:false, error:err.message });
  }
});

// ════════════════════════════════
//  COUNSELLING AI (Claude proxy)
//  Keeps API key safe on server
// ════════════════════════════════
app.post('/api/counsel', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error:'ANTHROPIC_API_KEY not configured on server' });
  }
  try {
    const { system, messages } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system,
        messages
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('❌ Counsel API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════
//  TTS PROXY — Google Translate TTS
//  Routes audio through server to avoid CORS
// ════════════════════════════════
app.get('/api/tts', async (req, res) => {
  const { text, lang } = req.query;
  if (!text || !lang) return res.status(400).send('Missing text or lang');
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });
    if (!response.ok) throw new Error('Google TTS returned ' + response.status);
    const buffer = await response.arrayBuffer();
    res.set({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('TTS proxy error:', err.message);
    res.status(500).send('TTS error');
  }
});

// ════════════════════════════════
//  TEST CALL ENDPOINT
// ════════════════════════════════
app.get('/api/test-call', async (req, res) => {
  if (!client) return res.json({ error:'Twilio not connected' });
  try {
    const call = await client.calls.create({
      to:   '+916366158568',
      from: TWILIO_PHONE_NUMBER,
      twiml: `<Response><Say voice="Polly.Raveena" language="en-IN">
        This is a test call from VitalWatch ICU at Samarthaa Hospital. System is working correctly.
      </Say></Response>`
    });
    res.json({ success:true, callSid:call.sid, to:'+916366158568' });
  } catch (err) {
    res.json({ success:false, error:err.message, code:err.code });
  }
});

// ════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    hospital:  'Samarthaa Hospital',
    ward:      'ICU Ward 6A',
    twilio:    client ? 'connected' : 'not configured',
    claude:    ANTHROPIC_API_KEY ? 'connected' : 'not configured',
    time:      new Date().toISOString()
  });
});

// ════════════════════════════════
//  STATIC FILES
// ════════════════════════════════
app.use(express.static(path.join(__dirname, '.')));

// Counselling page shortcut
app.get('/counselling', (req, res) => {
  res.sendFile(path.join(__dirname, 'counselling', 'index.html'));
});

// ── Keep-alive ping ──
setInterval(() => {
  https.get('https://virtual-icu.onrender.com/api/health', ()=>{}).on('error',()=>{});
}, 10 * 60 * 1000);

// ════════════════════════════════
//  START
// ════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   VitalWatch ICU — Samarthaa Hospital    ║');
  console.log('║   Ward 6A · Full Stack Server            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`🚀  Running on port ${PORT}`);
  console.log(`🏥  Dashboard:    http://localhost:${PORT}`);
  console.log(`💬  Counselling:  http://localhost:${PORT}/counselling`);
  console.log('');
});
