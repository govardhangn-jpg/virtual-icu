// ══════════════════════════════════════════════
//  VitalWatch Backend — Samarthaa Hospital
//  Handles: Phone Calls, WhatsApp, SMS
//  via Twilio
//
//  SETUP (one time):
//  1. npm install
//  2. Fill in your Twilio credentials below
//  3. node server.js
// ══════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const twilio   = require('twilio');
const path     = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ══════════════════════════════════════════════
//  TWILIO CREDENTIALS
//  Get these from https://console.twilio.com
//  Sign up free — you get $15 trial credit
// ══════════════════════════════════════════════
require('dotenv').config();
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER  = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ── Serve the frontend (index.html and all files) ──
app.use(express.static(path.join(__dirname, '.')));

// ════════════════════════════════
//  API: Make a Phone Call
//  POST /api/call
//  body: { to, patient, message, hospital, ward }
// ════════════════════════════════
app.post('/api/call', async (req, res) => {
  const { to, patient, message, hospital, ward } = req.body;

  if (!to || !patient || !message) {
    return res.status(400).json({ success: false, error: 'Missing fields' });
  }

  try {
    const call = await client.calls.create({
      to:   to,
      from: TWILIO_PHONE_NUMBER,
      twiml: `<Response>
        <Say voice="Polly.Raveena" language="en-IN">
          Critical alert from ${hospital || 'the ICU'}.
          Patient ${patient} requires immediate attention.
          ${message}.
          Please respond immediately to Ward ${ward || 'ICU'}.
          This call is from VitalWatch ICU monitoring system.
        </Say>
        <Pause length="1"/>
        <Say voice="Polly.Raveena" language="en-IN">
          Repeating. Patient ${patient}. ${message}. Please respond immediately.
        </Say>
      </Response>`
    });

    console.log(`✅ Call initiated to ${to} — SID: ${call.sid}`);
    res.json({ success: true, callSid: call.sid });

  } catch (err) {
    console.error('❌ Call failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════
//  API: Send WhatsApp Message
//  POST /api/whatsapp
//  body: { to, message }
// ════════════════════════════════
app.post('/api/whatsapp', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ success: false, error: 'Missing fields' });
  }

  try {
    // Format: whatsapp:+91XXXXXXXXXX
    const formattedTo = 'whatsapp:' + (to.startsWith('+') ? to : '+' + to);

    const msg = await client.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to:   formattedTo,
      body: message
    });

    console.log(`✅ WhatsApp sent to ${to} — SID: ${msg.sid}`);
    res.json({ success: true, messageSid: msg.sid });

  } catch (err) {
    console.error('❌ WhatsApp failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════
//  API: Send SMS
//  POST /api/sms
//  body: { to, message }
// ════════════════════════════════
app.post('/api/sms', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ success: false, error: 'Missing fields' });
  }

  try {
    const msg = await client.messages.create({
      from: TWILIO_PHONE_NUMBER,
      to:   to,
      body: message
    });

    console.log(`✅ SMS sent to ${to} — SID: ${msg.sid}`);
    res.json({ success: true, messageSid: msg.sid });

  } catch (err) {
    console.error('❌ SMS failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hospital: 'Samarthaa Hospital',
    ward: 'ICU Ward 6A',
    time: new Date().toISOString()
  });
});

// ── Start server ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   VitalWatch ICU — Backend Server    ║');
  console.log('║   Samarthaa Hospital · Ward 6A       ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📱 Open the app at: http://localhost:${PORT}/index.html\n`);
  console.log('Alert channels ready:');
  console.log('  📞 Phone calls  → POST /api/call');
  console.log('  💬 WhatsApp     → POST /api/whatsapp');
  console.log('  ✉  SMS          → POST /api/sms');
  console.log('\n⚠  Remember to fill in your Twilio credentials in server.js\n');
});
