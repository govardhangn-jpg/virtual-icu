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

// ════════════════════════════════════════════════
//  RECEIVE LIVE VITALS FROM OMRON BRIDGE
//  POST /api/vitals
//  Called by omron_bridge.py running on bedside laptop
// ════════════════════════════════════════════════
const liveVitalsStore = {};  // in-memory store: { patientId: { vitals, timestamp } }

app.post('/api/vitals', (req, res) => {
  const { patient_id, patient_name, bed, vitals, timestamp, source, api_key } = req.body;

  // Simple API key check
  const validKey = process.env.VITALWATCH_API_KEY || 'samarthaa-icu-2024';
  if (api_key !== validKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  if (!patient_id || !vitals) {
    return res.status(400).json({ error: 'Missing patient_id or vitals' });
  }

  // Store the reading
  liveVitalsStore[patient_id] = {
    patient_id, patient_name, bed,
    vitals,
    source: source || 'manual',
    timestamp: timestamp || new Date().toISOString(),
    received_at: new Date().toISOString()
  };

  console.log(`📡 Vitals received — ${patient_name || patient_id} (${bed}): BP ${vitals.bps}/${vitals.bpd} mmHg, HR ${vitals.hr || 'N/A'} bpm`);

  // Check thresholds and fire alert if needed
  const alerts = checkVitalThresholds(patient_id, patient_name, bed, vitals);
  if (alerts.length > 0 && client) {
    alerts.forEach(alert => fireAlert(alert));
  }

  res.json({ success: true, alerts: alerts.length });
});

// GET current vitals for all patients
app.get('/api/vitals', (req, res) => {
  const validKey = process.env.VITALWATCH_API_KEY || 'samarthaa-icu-2024';
  if (req.query.api_key !== validKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  res.json({ vitals: liveVitalsStore, count: Object.keys(liveVitalsStore).length });
});

// GET vitals for single patient
app.get('/api/vitals/:patientId', (req, res) => {
  const data = liveVitalsStore[req.params.patientId];
  if (!data) return res.status(404).json({ error: 'No data for this patient' });
  res.json(data);
});

// ── Threshold checking ──
const THRESHOLDS = {
  bps:  { warnHi: 145, critHi: 180, warnLo: 90,  critLo: 70  },
  bpd:  { warnHi: 95,  critHi: 110, warnLo: 55,  critLo: 40  },
  hr:   { warnHi: 105, critHi: 130, warnLo: 55,  critLo: 40  },
  spo2: { warnLo: 94,  critLo: 90 },
  temp: { warnHi: 38.3, critHi: 39.5, warnLo: 36.0, critLo: 35.0 },
};

function checkVitalThresholds(patientId, patientName, bed, vitals) {
  const alerts = [];
  for (const [key, val] of Object.entries(vitals)) {
    if (val == null || !THRESHOLDS[key]) continue;
    const t = THRESHOLDS[key];
    let level = null;
    let msg   = null;
    if (t.critLo && val <= t.critLo) { level = 'critical'; msg = `${key.toUpperCase()} critically low: ${val}`; }
    else if (t.critHi && val >= t.critHi) { level = 'critical'; msg = `${key.toUpperCase()} critically high: ${val}`; }
    else if (t.warnLo && val <= t.warnLo) { level = 'warning';  msg = `${key.toUpperCase()} low: ${val}`; }
    else if (t.warnHi && val >= t.warnHi) { level = 'warning';  msg = `${key.toUpperCase()} high: ${val}`; }
    if (level) alerts.push({ level, msg, patient: patientName, bed, vital: key, value: val });
  }
  return alerts;
}

// ── Auto-fire Twilio alerts for critical readings ──
async function fireAlert(alert) {
  if (!client || alert.level !== 'critical') return;
  const callTo   = process.env.TWILIO_PHONE_NUMBER_MAHESH || '+916366158568';
  const message  = `Critical alert at Samarthaa Hospital ICU Ward 6A. Patient ${alert.patient} in ${alert.bed}. ${alert.msg}. Please respond immediately.`;
  try {
    const call = await client.calls.create({
      to: callTo, from: TWILIO_PHONE_NUMBER,
      twiml: `<Response><Say voice="Polly.Raveena" language="en-IN">${message}</Say><Pause length="1"/><Say voice="Polly.Raveena" language="en-IN">${message}</Say></Response>`
    });
    console.log(`🚨 Auto-alert called Dr. Mahesh: ${call.sid}`);
  } catch(e) {
    console.error('Auto-alert failed:', e.message);
  }
}

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
