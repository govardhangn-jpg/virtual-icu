# VitalWatch ICU — Real-Time Patient Monitoring

A production-ready Progressive Web App (PWA) for ICU patient monitoring.
Works as both a **website** and **installable mobile app** on iOS and Android.

---

## Features

- **Live vitals dashboard** — Heart Rate, Blood Pressure, SpO₂, Temperature, Respiratory Rate, EtCO₂
- **Real-time ECG waveforms** per patient, per bed
- **Automatic alerts** — critical and warning thresholds with color-coded UI
- **Alert Center** — full log with acknowledge & call actions
- **Trend charts** — 24-hour historical view per vital
- **Periodic Reports** — configurable schedule, send via email/WhatsApp
- **Care Team management** — call and message stakeholders in-app
- **Threshold configuration** — per-patient customizable alert ranges
- **Role-based login** — Doctor, Nurse, Admin
- **PWA** — installs on iOS/Android as a native-feeling app
- **Fully offline-capable** via Service Worker

---

## Deployment (Static Hosting — No Backend Required for Demo)

### Option 1: Netlify (Recommended, Free)
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
cd icu-monitor
netlify deploy --prod --dir .
```

### Option 2: Vercel
```bash
npm install -g vercel
cd icu-monitor
vercel --prod
```

### Option 3: Firebase Hosting
```bash
npm install -g firebase-tools
firebase init hosting
firebase deploy
```

### Option 4: GitHub Pages
Push to GitHub → Settings → Pages → Deploy from main branch

---

## Mobile App Installation

### Android (Chrome)
1. Open the deployed URL in Chrome
2. Tap the "Add to Home Screen" banner or Menu → Add to Home Screen
3. App installs as a native-feeling app with its own icon

### iOS (Safari)
1. Open the deployed URL in Safari
2. Tap the Share button (box with arrow)
3. Tap "Add to Home Screen"
4. App installs with full-screen mode

### PWA Push Notifications (Production)
To enable real push notifications (for alerts):
1. Set up a backend with Web Push (VAPID keys)
2. Use Twilio for voice calls on critical alerts
3. Use Firebase Cloud Messaging for push

---

## Connecting Real Medical Devices

### HL7 FHIR Integration
Replace the simulated data in `js/data.js` with a real API:
```javascript
// Example: Fetch from HL7 FHIR endpoint
async function fetchLiveVitals(patientId) {
  const response = await fetch(`https://your-hl7-server/fhir/Observation?patient=${patientId}`);
  const bundle = await response.json();
  return parseHL7Bundle(bundle);
}
```

### MQTT / WebSocket (Real-time)
```javascript
const ws = new WebSocket('wss://your-icu-gateway/vitals');
ws.onmessage = (e) => {
  const vitals = JSON.parse(e.data);
  liveVitals[vitals.patientId] = vitals;
  refreshDashboard();
};
```

### Twilio (Auto-calls on Critical Alert)
Backend endpoint (Node.js example):
```javascript
const twilio = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);

async function callDoctor(doctorPhone, patientName, vitalAlert) {
  await twilio.calls.create({
    to: doctorPhone,
    from: YOUR_TWILIO_NUMBER,
    twiml: `<Response><Say>Critical alert: ${vitalAlert} for patient ${patientName}. Please respond immediately.</Say></Response>`
  });
}
```

---

## File Structure
```
icu-monitor/
├── index.html          # Main app (single-page application)
├── manifest.json       # PWA manifest (icons, theme, shortcuts)
├── sw.js               # Service Worker (offline + push notifications)
├── css/
│   └── app.css         # Full stylesheet (dark clinical theme)
└── js/
    ├── data.js         # Patient data, stakeholders, thresholds
    ├── vitals.js       # Vitals simulation engine, ECG waveforms
    ├── charts.js       # Trend chart rendering
    └── app.js          # Main app logic, navigation, UI
```

---

## Compliance Notes
- Designed to be **DISHA compliant** (India Digital Health)
- **HL7 FHIR R4** ready for device integration
- All data transmission should use **TLS 1.3**
- Implement **audit logging** for all alert acknowledgments in production
- Consider **HIPAA/PHI** data handling if deployed internationally

---

## Tech Stack
- Vanilla HTML/CSS/JS — zero dependencies, fast, no build step
- Progressive Web App (PWA) with Service Worker
- Space Mono + Sora fonts (Google Fonts)
- Canvas API for ECG waveforms and trend charts
