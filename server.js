require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());

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
  console.log('⚠️  Twilio not configured — alerts will be skipped');
}

app.post('/api/call', async (req, res) => {
  const { to, patient, message, hospital, ward } = req.body;
  if (!client) return res.json({ success: false, error: 'Twilio not configured' });
  try {
    const call = await client.calls.create({
      to,
      from: TWILIO_PHONE_NUMBER,
      twiml: `<Response>
        <Say voice="Polly.Raveena" language="en-IN">
          Critical alert from ${hospital}. Patient ${patient}. ${message}. Please respond immediately.
        </Say>
        <Pause length="1"/>
        <Say voice="Polly.Raveena" language="en-IN">
          Repeating. Patient ${patient}. ${message}. Please respond immediately.
        </Say>
      </Response>`
    });
    console.log('✅ Call initiated:', call.sid);
    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    console.error('❌ Call failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whatsapp', async (req, res) => {
  const { to, message } = req.body;
  if (!client) return res.json({ success: false, error: 'Twilio not configured' });
  try {
    const formattedTo = 'whatsapp:' + (to.startsWith('+') ? to : '+' + to);
    const msg = await client.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to:   formattedTo,
      body: message
    });
    console.log('✅ WhatsApp sent:', msg.sid);
    res.json({ success: true, messageSid: msg.sid });
  } catch (err) {
    console.error('❌ WhatsApp failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sms', async (req, res) => {
  const { to, message } = req.body;
  if (!client) return res.json({ success: false, error: 'Twilio not configured' });
  try {
    const msg = await client.messages.create({
      from: TWILIO_PHONE_NUMBER,
      to,
      body: message
    });
    console.log('✅ SMS sent:', msg.sid);
    res.json({ success: true, messageSid: msg.sid });
  } catch (err) {
    console.error('❌ SMS failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hospital: 'Samarthaa Hospital',
    ward: 'ICU Ward 6A',
    twilio: client ? 'connected' : 'not configured',
    time: new Date().toISOString()
  });
});

// Serve the frontend
app.use(express.static(path.join(__dirname, '.')));

// Keep-alive ping (prevents Render free tier from sleeping)
setInterval(() => {
  const https = require('https');
  https.get('https://virtual-icu.onrender.com/api/health', () => {}).on('error', () => {});
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   VitalWatch ICU — Samarthaa Hospital ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`🚀 Running on port ${PORT}`);
  console.log(`📱 Twilio: ${client ? 'Connected ✅' : 'Not configured ⚠️'}`);
});