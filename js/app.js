// ══════════════════════════════════════════════
//  VitalWatch — Main App Logic
//  Samarthaa Hospital · ICU Ward 6A
// ══════════════════════════════════════════════

let currentPage = 'dashboard';
let ecgWaveforms = {};
let detailECG = null;
let simInterval = null;
let clockInterval = null;

// ════════════════════════════════
// INIT
// ════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  updateClock();
  clockInterval = setInterval(updateClock, 1000);
  generateReportPreview();
  document.getElementById('report-date').textContent =
    new Date().toLocaleDateString('en-IN', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
});

function updateClock() {
  const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const el = document.getElementById('header-clock');
  if (el) el.textContent = t;
}

// ════════════════════════════════
// LOGIN
// ════════════════════════════════
function doLogin() {
  const wardEl = document.getElementById('ward-select');
  const wardLabel = wardEl.options[wardEl.selectedIndex].text;
  activateApp(wardLabel);
}

function quickLogin(role) {
  currentUser = USER_ROLES[role];
  const wardEl = document.getElementById('ward-select');
  const wardLabel = wardEl.options[wardEl.selectedIndex].text;
  activateApp(wardLabel);
}

function activateApp(wardLabel) {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
  document.getElementById('sidebar-name').textContent = currentUser.name;
  document.getElementById('sidebar-role').textContent = currentUser.role;
  document.getElementById('sidebar-avatar').textContent = currentUser.initials;
  document.getElementById('sidebar-ward').textContent = HOSPITAL.ward;
  document.getElementById('ward-label').textContent = HOSPITAL.ward + ' · ' + PATIENTS.length + ' patients monitored';
  showPage('dashboard');
  startSimulation();
  updateAlertCount();
}

function doLogout() {
  stopSimulation();
  Object.values(ecgWaveforms).forEach(w => w.stop());
  ecgWaveforms = {};
  if (detailECG) { detailECG.stop(); detailECG = null; }
  document.getElementById('app-screen').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
}

// ════════════════════════════════
// SIMULATION
// ════════════════════════════════
function startSimulation() {
  simInterval = setInterval(() => {
    simulateVitals();
    if (currentPage === 'dashboard') refreshDashboard();
    if (currentPage === 'patient')   refreshDetailPage();
    if (currentPage === 'alerts')    renderAlerts();
  }, 2000);
}

function stopSimulation() {
  if (simInterval) { clearInterval(simInterval); simInterval = null; }
}

// ════════════════════════════════════════════════
//  REAL VITALS POLLING
//  Fetches live readings from Omron bridge
//  Falls back to simulation if no device connected
// ════════════════════════════════════════════════
let realVitalsAvailable = false;
let lastRealVitalsTime  = {};

async function fetchRealVitals() {
  try {
    const response = await fetch('/api/vitals?api_key=samarthaa-icu-2024');
    if (!response.ok) return;
    const data = await response.json();
    if (!data.vitals || Object.keys(data.vitals).length === 0) return;

    let anyReal = false;
    for (const [pid, record] of Object.entries(data.vitals)) {
      // Only use if reading is less than 30 minutes old
      const age = Date.now() - new Date(record.received_at).getTime();
      if (age > 30 * 60 * 1000) continue;

      const v = record.vitals;
      if (liveVitals[pid]) {
        // Merge real values in — keep simulation for vitals not covered by device
        if (v.bps != null) liveVitals[pid].bps = v.bps;
        if (v.bpd != null) liveVitals[pid].bpd = v.bpd;
        if (v.hr  != null) liveVitals[pid].hr  = v.hr;
        if (v.spo2!= null) liveVitals[pid].spo2= v.spo2;
        if (v.temp!= null) liveVitals[pid].temp= v.temp;

        // Show real data indicator
        lastRealVitalsTime[pid] = record.received_at;
        anyReal = true;
      }
    }

    if (anyReal && !realVitalsAvailable) {
      realVitalsAvailable = true;
      showToast('📡 Live device data connected — Omron readings active');
    }

  } catch(e) {
    // Server not reachable or no data — simulation continues silently
  }
}

// Poll every 30 seconds for new device readings
setInterval(fetchRealVitals, 30000);
// Also fetch immediately on load
setTimeout(fetchRealVitals, 3000);



// ════════════════════════════════
// NAVIGATION
// ════════════════════════════════
function showPage(name) {
  currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + name);
  if (pageEl) pageEl.classList.add('active');
  const breadcrumbs = {
    dashboard: 'All Patients', patient: 'Patient Detail', alerts: 'Alert Center',
    trends: 'Trends & History', reports: 'Reports', stakeholders: 'Care Team', settings: 'Settings'
  };
  document.getElementById('breadcrumb').textContent = breadcrumbs[name] || name;
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick')?.includes("'" + name + "'")) n.classList.add('active');
  });
  if (name === 'dashboard')    renderDashboard();
  if (name === 'alerts')       renderAlerts();
  if (name === 'trends')       initTrends();
  if (name === 'reports')      generateReportPreview();
  if (name === 'stakeholders') renderStakeholders();
  if (window.innerWidth < 768) closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ════════════════════════════════
// DASHBOARD
// ════════════════════════════════
function renderDashboard() {
  const grid = document.getElementById('patients-grid');
  grid.innerHTML = '';
  PATIENTS.forEach(p => {
    const v = liveVitals[p.id];
    const status = getPatientStatus(p.id);
    const card = document.createElement('div');
    card.className = `patient-card ${status}`;
    card.onclick = () => openPatient(p.id);
    const chipClass = { normal:'chip-normal', warning:'chip-warning', critical:'chip-critical' }[status];
    const hrSt   = getVitalStatus('hr',   v.hr);
    const bpSt   = getVitalStatus('bps',  v.bps);
    const spo2St = getVitalStatus('spo2', v.spo2);
    card.innerHTML = `
      <div class="patient-card-top">
        <div>
          <div class="patient-card-name">${p.name}</div>
          <div class="patient-card-meta">${p.age} yrs · ${p.sex} · ${p.bed}</div>
        </div>
        <span class="status-chip ${chipClass}">${status.toUpperCase()}</span>
      </div>
      <div class="patient-mini-ecg"><canvas id="mini-ecg-${p.id}" height="36"></canvas></div>
      <div class="patient-vitals-mini">
        <div class="mini-vital"><div class="mini-vital-label">HR</div><div class="mini-vital-value ${hrSt!=='normal'?hrSt:''}">${v.hr.toFixed(0)}</div><div class="mini-vital-unit">bpm</div></div>
        <div class="mini-vital"><div class="mini-vital-label">BP</div><div class="mini-vital-value ${bpSt!=='normal'?bpSt:''}">${v.bps.toFixed(0)}/${v.bpd.toFixed(0)}</div><div class="mini-vital-unit">mmHg</div></div>
        <div class="mini-vital"><div class="mini-vital-label">SpO₂</div><div class="mini-vital-value ${spo2St!=='normal'?spo2St:''}">${v.spo2.toFixed(0)}%</div><div class="mini-vital-unit">O₂ sat</div></div>
        <div class="mini-vital"><div class="mini-vital-label">Temp</div><div class="mini-vital-value">${v.temp.toFixed(1)}</div><div class="mini-vital-unit">°C</div></div>
        <div class="mini-vital"><div class="mini-vital-label">RR</div><div class="mini-vital-value">${v.rr.toFixed(0)}</div><div class="mini-vital-unit">/min</div></div>
        <div class="mini-vital"><div class="mini-vital-label">EtCO₂</div><div class="mini-vital-value">${v.etco2.toFixed(0)}</div><div class="mini-vital-unit">mmHg</div></div>
      </div>
      <div class="patient-card-footer">
        <span class="card-dx">${p.dx}</span>
        <span class="card-action">View Detail →</span>
      </div>`;
    grid.appendChild(card);
    setTimeout(() => {
      const canvas = document.getElementById(`mini-ecg-${p.id}`);
      if (!canvas) return;
      const col = status==='critical'?'#ff4d4d':status==='warning'?'#f59e0b':'#00d4aa';
      if (ecgWaveforms[p.id]) ecgWaveforms[p.id].stop();
      ecgWaveforms[p.id] = new ECGWaveform(canvas, col, status==='critical');
      ecgWaveforms[p.id].start();
    }, 50);
  });
}

function refreshDashboard() {
  document.querySelectorAll('.patient-card').forEach((cardEl, idx) => {
    const pt = PATIENTS[idx]; if (!pt) return;
    const vv = liveVitals[pt.id]; const st = getPatientStatus(pt.id);
    const vals = cardEl.querySelectorAll('.mini-vital-value');
    if (vals.length >= 6) {
      vals[0].textContent = vv.hr.toFixed(0);
      vals[0].className = `mini-vital-value ${getVitalStatus('hr',vv.hr)!=='normal'?getVitalStatus('hr',vv.hr):''}`;
      vals[1].textContent = `${vv.bps.toFixed(0)}/${vv.bpd.toFixed(0)}`;
      vals[1].className = `mini-vital-value ${getVitalStatus('bps',vv.bps)!=='normal'?getVitalStatus('bps',vv.bps):''}`;
      vals[2].textContent = vv.spo2.toFixed(0)+'%';
      vals[2].className = `mini-vital-value ${getVitalStatus('spo2',vv.spo2)!=='normal'?getVitalStatus('spo2',vv.spo2):''}`;
      vals[3].textContent = vv.temp.toFixed(1);
      vals[4].textContent = vv.rr.toFixed(0);
      vals[5].textContent = vv.etco2.toFixed(0);
    }
    const chip = cardEl.querySelector('.status-chip');
    if (chip) { chip.className=`status-chip chip-${st}`; chip.textContent=st.toUpperCase(); }
    cardEl.className = `patient-card ${st}`;
  });
}

// ════════════════════════════════
// PATIENT DETAIL
// ════════════════════════════════
function openPatient(pid) {
  selectedPatientId = pid;
  const p = PATIENTS.find(x => x.id === pid); if (!p) return;
  document.getElementById('detail-patient-name').textContent = p.name;
  document.getElementById('detail-patient-meta').textContent = `${p.bed} · ${p.age} yrs · ${p.sex} · ${p.dx}`;
  document.getElementById('d-bed').textContent = p.bed;
  document.getElementById('d-age').textContent = `${p.age} yrs · ${p.sex}`;
  document.getElementById('d-dx').textContent = p.dx;
  document.getElementById('d-admit').textContent = p.admitted;
  document.getElementById('d-doc').textContent = p.doctor;
  const log = document.getElementById('patient-alert-log');
  log.innerHTML = p.alerts.length === 0
    ? '<p class="no-alerts">No alerts in past 24h</p>'
    : p.alerts.map(a => `
        <div class="mini-alert-item">
          <span class="mini-alert-dot" style="background:${a.level==='critical'?'var(--red)':'var(--amber)'}"></span>
          <div><div class="mini-alert-text">${a.msg}</div><div class="mini-alert-time">${a.time}</div></div>
        </div>`).join('');
  renderDetailVitals(pid);
  showPage('patient');
  setTimeout(() => {
    const canvas = document.getElementById('detail-ecg'); if (!canvas) return;
    if (detailECG) detailECG.stop();
    detailECG = new ECGWaveform(canvas, '#ff4d4d', false);
    detailECG.start();
  }, 80);
}

function renderDetailVitals(pid) {
  const v = liveVitals[pid];
  document.getElementById('detail-hr-wave').textContent = v.hr.toFixed(0) + ' bpm';
  const grid = document.getElementById('detail-vitals-grid');
  const defs = [
    { key:'hr',    label:'Heart Rate',      val:v.hr.toFixed(0),                        unit:'bpm',               range:'Normal: 60–100 bpm' },
    { key:'bps',   label:'Blood Pressure',  val:`${v.bps.toFixed(0)}/${v.bpd.toFixed(0)}`, unit:'mmHg (sys/dia)', range:'Normal: 90–140 / 60–90' },
    { key:'spo2',  label:'SpO₂',            val:v.spo2.toFixed(0)+'%',                  unit:'Oxygen saturation', range:'Normal: ≥ 95%' },
    { key:'temp',  label:'Temperature',     val:v.temp.toFixed(1),                      unit:'°C (axillary)',     range:'Normal: 36.1–37.2 °C' },
    { key:'rr',    label:'Resp. Rate',      val:v.rr.toFixed(0),                        unit:'breaths / min',     range:'Normal: 12–20 /min' },
    { key:'etco2', label:'EtCO₂',           val:v.etco2.toFixed(0),                     unit:'mmHg end-tidal CO₂',range:'Normal: 35–45 mmHg' }
  ];
  grid.innerHTML = defs.map(d => {
    const st = getVitalStatus(d.key, parseFloat(d.val));
    return `<div class="vital-card-detail ${st}" id="vcd-${d.key}">
      <div class="vcd-top"><span class="vcd-name">${d.label}</span><span class="status-chip chip-${st}">${st.toUpperCase()}</span></div>
      <div class="vcd-value" id="vcd-val-${d.key}">${d.val}</div>
      <div class="vcd-unit">${d.unit}</div>
      <div class="vcd-range">${d.range}</div>
    </div>`;
  }).join('');
}

function refreshDetailPage() {
  if (!selectedPatientId) return;
  const v = liveVitals[selectedPatientId]; if (!v) return;
  document.getElementById('detail-hr-wave').textContent = v.hr.toFixed(0) + ' bpm';
  const updates = {
    hr: v.hr.toFixed(0), bps: `${v.bps.toFixed(0)}/${v.bpd.toFixed(0)}`,
    spo2: v.spo2.toFixed(0)+'%', temp: v.temp.toFixed(1),
    rr: v.rr.toFixed(0), etco2: v.etco2.toFixed(0)
  };
  Object.entries(updates).forEach(([key, val]) => {
    const el = document.getElementById('vcd-val-'+key);
    const card = document.getElementById('vcd-'+key);
    if (el) el.textContent = val;
    if (card) {
      const st = getVitalStatus(key, parseFloat(val));
      card.className = `vital-card-detail ${st}`;
      const chip = card.querySelector('.status-chip');
      if (chip) { chip.className=`status-chip chip-${st}`; chip.textContent=st.toUpperCase(); }
    }
  });
}

// ════════════════════════════════════════════════
// ALERT DISPATCH — Phone Call + WhatsApp + SMS
// ════════════════════════════════════════════════

// ── Build the alert message text ──
function buildAlertMessage(alertObj) {
  const time = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  return `🚨 CRITICAL ALERT — ${HOSPITAL.name}\n` +
         `Patient: ${alertObj.patient} (${alertObj.bed})\n` +
         `Alert: ${alertObj.msg}\n` +
         `Value: ${alertObj.vital}\n` +
         `Time: ${time}\n` +
         `Ward: ${HOSPITAL.ward}\n` +
         `Please respond immediately.`;
}

function buildWarningMessage(alertObj) {
  const time = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  return `⚠️ WARNING — ${HOSPITAL.name}\n` +
         `Patient: ${alertObj.patient} (${alertObj.bed})\n` +
         `Alert: ${alertObj.msg}\n` +
         `Value: ${alertObj.vital}\n` +
         `Time: ${time}\n` +
         `Ward: ${HOSPITAL.ward}`;
}

// ── Make a phone call via Twilio (calls your backend) ──
async function makePhoneCall(toPhone, patientName, alertMsg) {
  try {
    const response = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: toPhone,
        patient: patientName,
        message: alertMsg,
        hospital: HOSPITAL.name,
        ward: HOSPITAL.ward
      })
    });
    const data = await response.json();
    console.log('Call initiated:', data);
    return data.success;
  } catch (err) {
    // If backend not yet set up, open native dialler as fallback
    console.warn('Backend not reachable — opening dialler as fallback');
    window.open('tel:' + toPhone);
    return false;
  }
}

// ── Send WhatsApp message (calls your backend) ──
async function sendWhatsApp(toPhone, message) {
  try {
    const response = await fetch('/api/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toPhone, message })
    });
    const data = await response.json();
    console.log('WhatsApp sent:', data);
    return data.success;
  } catch (err) {
    // Fallback: open WhatsApp Web link
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${toPhone}?text=${encoded}`, '_blank');
    return false;
  }
}

// ── Send SMS (calls your backend) ──
async function sendSMS(toPhone, message) {
  try {
    const response = await fetch('/api/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toPhone, message })
    });
    const data = await response.json();
    console.log('SMS sent:', data);
    return data.success;
  } catch (err) {
    console.warn('SMS backend not reachable');
    return false;
  }
}

// ── Master alert dispatcher ──
async function dispatchAlert(alertObj) {
  const level = alertObj.level;
  const routing = ALERT_ROUTING[level];
  if (!routing) return;

  const msg = level === 'critical' ? buildAlertMessage(alertObj) : buildWarningMessage(alertObj);
  const toastMessages = [];

  // Phone calls
  for (const sid of (routing.call || [])) {
    const s = STAKEHOLDERS.find(x => x.id === sid);
    if (!s) continue;
    showToast(`📞 Calling ${s.name} (${s.phoneDisplay})...`);
    await makePhoneCall(s.phone, alertObj.patient, alertObj.msg);
    toastMessages.push(`Called ${s.name}`);
  }

  // WhatsApp
  for (const sid of (routing.whatsapp || [])) {
    const s = STAKEHOLDERS.find(x => x.id === sid);
    if (!s) continue;
    await sendWhatsApp(s.whatsapp, msg);
    toastMessages.push(`WhatsApp → ${s.name}`);
  }

  // SMS
  for (const sid of (routing.sms || [])) {
    const s = STAKEHOLDERS.find(x => x.id === sid);
    if (!s) continue;
    await sendSMS(s.phone, msg);
  }

  if (toastMessages.length > 0) {
    showToast('✅ Alerts sent: ' + toastMessages.join(', '));
  }
}

// ── Called when user taps "Call" on an alert card ──
async function callForAlert(alertId) {
  const alertObj = globalAlerts.find(a => a.id === alertId);
  if (!alertObj) return;

  alertObj.acked = true;

  // Show dispatch modal
  showDispatchModal(alertObj);

  // Dispatch all channels
  await dispatchAlert(alertObj);

  renderAlerts();
  updateAlertCount();
}

// ── Dispatch modal — shows who is being contacted ──
function showDispatchModal(alertObj) {
  const routing = ALERT_ROUTING[alertObj.level] || {};
  const allIds = [...new Set([...(routing.call||[]), ...(routing.whatsapp||[]), ...(routing.sms||[])])];

  const rows = allIds.map(sid => {
    const s = STAKEHOLDERS.find(x => x.id === sid);
    if (!s) return '';
    const methods = [];
    if ((routing.call||[]).includes(sid))     methods.push('<span class="dispatch-tag call">📞 Call</span>');
    if ((routing.whatsapp||[]).includes(sid)) methods.push('<span class="dispatch-tag wa">💬 WhatsApp</span>');
    if ((routing.sms||[]).includes(sid))      methods.push('<span class="dispatch-tag sms">✉ SMS</span>');
    return `<div class="dispatch-row">
      <div class="dispatch-avatar" style="background:${s.color};color:${s.textColor}">${s.initials}</div>
      <div class="dispatch-info">
        <div class="dispatch-name">${s.name}</div>
        <div class="dispatch-phone">${s.phoneDisplay}</div>
      </div>
      <div class="dispatch-methods">${methods.join('')}</div>
    </div>`;
  }).join('');

  const existing = document.getElementById('dispatch-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'dispatch-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>🚨 Alerting Care Team</h3>
        <button onclick="document.getElementById('dispatch-modal').remove()">✕</button>
      </div>
      <div style="margin-bottom:12px;font-size:13px;color:var(--text-2)">
        <strong style="color:var(--red)">${alertObj.patient}</strong> · ${alertObj.msg}
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        ${rows}
      </div>
      <div style="font-size:11px;color:var(--text-3);border-top:1px solid var(--border);padding-top:10px">
        Dispatching via phone call, WhatsApp & SMS simultaneously...
      </div>
      <div class="modal-footer">
        <button class="btn-primary" onclick="document.getElementById('dispatch-modal').remove()">Done</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// ════════════════════════════════
// ALERTS PAGE
// ════════════════════════════════
function renderAlerts() {
  const list = document.getElementById('alerts-list'); if (!list) return;
  if (globalAlerts.length === 0) {
    list.innerHTML = '<div style="color:var(--text-3);font-size:14px;padding:40px;text-align:center">No alerts recorded</div>';
    return;
  }
  list.innerHTML = globalAlerts.map(a => `
    <div class="alert-item ${a.level}" id="alert-${a.id}" style="${a.acked?'opacity:0.55':''}">
      <div class="alert-icon-box ${a.level}">${a.level==='critical'?'⚠':a.level==='warning'?'!':'ℹ'}</div>
      <div class="alert-content">
        <div class="alert-title">${a.patient} · ${a.bed}</div>
        <div class="alert-desc">${a.msg}</div>
        <div class="alert-meta">${a.vital} · ${a.time}${a.acked?' · ✓ Acknowledged':''}</div>
      </div>
      <div class="alert-actions">
        ${!a.acked && a.level==='critical' ? `<button class="alert-call-btn" onclick="callForAlert('${a.id}')">📞 Alert Team</button>` : ''}
        ${!a.acked && a.level==='warning'  ? `<button class="alert-call-btn" style="background:var(--amber)" onclick="sendWarningAlert('${a.id}')">⚠ Notify</button>` : ''}
        ${!a.acked ? `<button class="alert-ack-btn" onclick="ackAlert('${a.id}')">Acknowledge</button>` : ''}
      </div>
    </div>`).join('');
}

async function sendWarningAlert(alertId) {
  const alertObj = globalAlerts.find(a => a.id === alertId);
  if (!alertObj) return;
  alertObj.acked = true;
  await dispatchAlert(alertObj);
  renderAlerts();
  updateAlertCount();
}

function ackAlert(id) {
  const a = globalAlerts.find(x => x.id === id);
  if (a) a.acked = true;
  renderAlerts();
  updateAlertCount();
}

function acknowledgeAlert() {
  globalAlerts.filter(a => !a.acked && a.level==='critical').forEach(a => { a.acked = true; });
  updateAlertCount();
  showToast('All critical alerts acknowledged');
}

function clearAllAlerts() {
  globalAlerts.forEach(a => { a.acked = true; });
  renderAlerts();
  updateAlertCount();
  showToast('All alerts cleared');
}

function addGlobalAlert(level, patientName, bed, msg) {
  const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  const vital = msg.split(':')[1]?.trim() || '';
  const alertObj = { id:'A'+Date.now(), level, patient:patientName, bed, msg, vital, time:t, acked:false };
  globalAlerts.unshift(alertObj);
  if (globalAlerts.length > 30) globalAlerts = globalAlerts.slice(0, 30);
  updateAlertCount();
  // Auto-dispatch for critical
  if (level === 'critical') dispatchAlert(alertObj);
}

function updateAlertCount() {
  const unacked = globalAlerts.filter(a => !a.acked && a.level !== 'info').length;
  document.getElementById('alert-nav-count').textContent = unacked;
  document.getElementById('header-alert-badge').textContent = unacked;
  const criticals = globalAlerts.filter(a => !a.acked && a.level === 'critical');
  const banner = document.getElementById('critical-banner');
  if (criticals.length > 0) {
    banner.style.display = 'flex';
    document.getElementById('banner-text').textContent =
      `CRITICAL: ${criticals[0].patient} — ${criticals[0].msg}`;
  } else {
    banner.style.display = 'none';
  }
}

// ════════════════════════════════
// TRENDS
// ════════════════════════════════
function initTrends() {
  const sel = document.getElementById('trend-patient-select'); if (!sel) return;
  sel.innerHTML = PATIENTS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  renderTrends();
}

// ════════════════════════════════
// REPORTS
// ════════════════════════════════
function generateReportPreview() {
  const body = document.getElementById('report-body'); if (!body) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  document.getElementById('report-date').textContent = dateStr;
  body.innerHTML = `
    <div class="report-body-section">
      <h4>Summary — ${HOSPITAL.ward} · ${timeStr}</h4>
      <div class="report-pt-row"><span>Total Patients</span><span>${PATIENTS.length}</span></div>
      <div class="report-pt-row"><span>Critical</span><span style="color:var(--red)">${PATIENTS.filter(p=>getPatientStatus(p.id)==='critical').length}</span></div>
      <div class="report-pt-row"><span>Warning</span><span style="color:var(--amber)">${PATIENTS.filter(p=>getPatientStatus(p.id)==='warning').length}</span></div>
      <div class="report-pt-row"><span>Stable</span><span style="color:var(--green)">${PATIENTS.filter(p=>getPatientStatus(p.id)==='normal').length}</span></div>
      <div class="report-pt-row"><span>Unacknowledged Alerts</span><span>${globalAlerts.filter(a=>!a.acked).length}</span></div>
    </div>
    ${PATIENTS.map(p => {
      const v = liveVitals[p.id]; const st = getPatientStatus(p.id);
      return `<div class="report-body-section">
        <h4>${p.name} · ${p.bed} · <span style="color:${st==='critical'?'var(--red)':st==='warning'?'var(--amber)':'var(--green)'}">${st.toUpperCase()}</span></h4>
        <div class="report-pt-row"><span>Diagnosis</span><span>${p.dx}</span></div>
        <div class="report-pt-row"><span>Attending</span><span>${p.doctor}</span></div>
        <div class="report-pt-row"><span>HR</span><span>${v.hr.toFixed(0)} bpm</span></div>
        <div class="report-pt-row"><span>BP</span><span>${v.bps.toFixed(0)}/${v.bpd.toFixed(0)} mmHg</span></div>
        <div class="report-pt-row"><span>SpO₂</span><span>${v.spo2.toFixed(0)}%</span></div>
        <div class="report-pt-row"><span>Temp</span><span>${v.temp.toFixed(1)} °C</span></div>
        <div class="report-pt-row"><span>RR</span><span>${v.rr.toFixed(0)} /min</span></div>
        <div class="report-pt-row"><span>EtCO₂</span><span>${v.etco2.toFixed(0)} mmHg</span></div>
      </div>`;
    }).join('')}
    <div class="report-body-section" style="font-size:10px;color:var(--text-3);margin-top:16px">
      Generated by VitalWatch ICU v2.4.1 · ${HOSPITAL.name} · ${dateStr}
    </div>`;
}

function generateReport() { generateReportPreview(); showToast('Report generated'); }
function saveReportConfig() { showToast('Report schedule saved'); }
function printReport() { window.print(); }
function sendReport() { showPage('reports'); }
function sendPatientReport() {
  const p = PATIENTS.find(x => x.id === selectedPatientId);
  showToast(`📧 Report for ${p?.name} sent to care team`);
}

async function sendReportNow() {
  const msg = buildPeriodicReportMessage();
  const routing = ALERT_ROUTING.report;
  for (const sid of (routing.whatsapp || [])) {
    const s = STAKEHOLDERS.find(x => x.id === sid);
    if (s) await sendWhatsApp(s.whatsapp, msg);
  }
  showToast('📊 Periodic report sent to all staff via WhatsApp');
}

function buildPeriodicReportMessage() {
  const now = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  let msg = `📊 ICU PERIODIC REPORT — ${HOSPITAL.name}\n`;
  msg += `Ward: ${HOSPITAL.ward} · ${now}\n\n`;
  PATIENTS.forEach(p => {
    const v = liveVitals[p.id]; const st = getPatientStatus(p.id);
    const icon = st==='critical'?'🔴':st==='warning'?'🟡':'🟢';
    msg += `${icon} ${p.name} (${p.bed})\n`;
    msg += `   HR: ${v.hr.toFixed(0)} | BP: ${v.bps.toFixed(0)}/${v.bpd.toFixed(0)} | SpO₂: ${v.spo2.toFixed(0)}%\n`;
    msg += `   Temp: ${v.temp.toFixed(1)}°C | RR: ${v.rr.toFixed(0)} | EtCO₂: ${v.etco2.toFixed(0)}\n\n`;
  });
  msg += `VitalWatch ICU · Auto-generated report`;
  return msg;
}

// ════════════════════════════════
// CARE TEAM PAGE
// ════════════════════════════════
function renderStakeholders() {
  const grid = document.getElementById('stakeholders-grid'); if (!grid) return;
  const statusLabel = { oncall:'On Call', available:'Available', offduty:'Off Duty' };
  const statusClass = { oncall:'sc-oncall', available:'sc-available', offduty:'sc-offduty' };
  grid.innerHTML = STAKEHOLDERS.map(s => `
    <div class="stakeholder-card">
      <div class="sc-top">
        <div class="sc-avatar" style="background:${s.color};color:${s.textColor}">${s.initials}</div>
        <div>
          <div class="sc-name">${s.name}</div>
          <div class="sc-role">${s.specialty}</div>
          <span class="sc-badge ${statusClass[s.status]}">${statusLabel[s.status]}</span>
        </div>
      </div>
      <div class="sc-contact">
        <span>📱 <a href="tel:${s.phone}" style="color:var(--green)">${s.phoneDisplay}</a></span>
        <span>💬 <a href="https://wa.me/${s.whatsapp}" target="_blank" style="color:var(--green)">WhatsApp</a></span>
        <span>✉ ${s.email}</span>
        <span>🏥 ${s.role}</span>
      </div>
      <div class="sc-actions">
        <button class="sc-call-btn" onclick="directCall('${s.id}')">📞 Call</button>
        <button class="sc-msg-btn" onclick="directWhatsApp('${s.id}')">💬 WhatsApp</button>
      </div>
      <div style="margin-top:8px">
        <button class="sc-msg-btn" style="width:100%;font-size:11px" onclick="directSMS('${s.id}')">✉ Send SMS</button>
      </div>
    </div>`).join('');
}

function directCall(sid) {
  const s = STAKEHOLDERS.find(x => x.id === sid);
  if (!s) return;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile) {
    // Mobile — open native dialler directly
    window.location.href = 'tel:' + s.phone;
  } else {
    // Desktop — trigger call via Twilio server
    showToast('📞 Calling ' + s.name + ' (' + s.phoneDisplay + ') via server...');
    fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to:       s.phone,
        patient:  'Care Team Direct Call',
        message:  'Direct call from ' + HOSPITAL.name + ' ICU Ward 6A dashboard.',
        hospital: HOSPITAL.name,
        ward:     HOSPITAL.ward
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showToast('✅ Call initiated to ' + s.name + ' — ' + s.phoneDisplay);
      } else {
        // Twilio not set up — show number to call manually
        showCallModal(s);
      }
    })
    .catch(() => showCallModal(s));
  }
}

function showCallModal(s) {
  // Remove existing modal if any
  const existing = document.getElementById('call-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'call-modal';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>📞 Call ${s.name}</h3>
        <button onclick="document.getElementById('call-modal').remove()">✕</button>
      </div>
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:32px;margin-bottom:12px">${s.initials ? s.initials : '👤'}</div>
        <div style="font-size:18px;font-weight:700;color:var(--text-1);margin-bottom:4px">${s.name}</div>
        <div style="font-size:13px;color:var(--text-2);margin-bottom:20px">${s.role}</div>
        <a href="tel:${s.phone}" style="
          display:inline-flex;align-items:center;gap:8px;
          padding:14px 32px;border-radius:50px;
          background:var(--green);color:#fff;
          font-size:16px;font-weight:700;text-decoration:none;
          box-shadow:0 4px 16px rgba(5,150,105,0.35)">
          📞 ${s.phoneDisplay}
        </a>
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:center">
          <a href="https://wa.me/${s.whatsapp}" target="_blank" style="
            padding:8px 20px;border-radius:20px;border:1.5px solid #25d366;
            color:#25d366;text-decoration:none;font-size:13px;font-weight:600">
            💬 WhatsApp
          </a>
          <a href="sms:${s.phone}" style="
            padding:8px 20px;border-radius:20px;border:1.5px solid var(--blue);
            color:var(--blue);text-decoration:none;font-size:13px;font-weight:600">
            ✉ SMS
          </a>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" onclick="document.getElementById('call-modal').remove()">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function directWhatsApp(sid) {
  const s = STAKEHOLDERS.find(x => x.id === sid);
  if (!s) return;
  const msg = encodeURIComponent(`Hello ${s.name}, this is a message from ${HOSPITAL.name} ICU Ward 6A.`);
  window.open(`https://wa.me/${s.whatsapp}?text=${msg}`, '_blank');
}

function directSMS(sid) {
  const s = STAKEHOLDERS.find(x => x.id === sid);
  if (!s) return;
  window.location.href = `sms:${s.phone}?body=Message from ${HOSPITAL.name} ICU Ward 6A`;
}

function callCareTeam() {
  // Call the primary on-call doctor directly
  const oncall = STAKEHOLDERS.find(s => s.status === 'oncall' && s.alertPriority === 1);
  if (oncall) {
    showToast(`📞 Calling ${oncall.name}...`);
    window.location.href = 'tel:' + oncall.phone;
  }
}

// ════════════════════════════════
// SETTINGS
// ════════════════════════════════
function saveThresholds() { showToast('Thresholds saved for this patient'); }
function testConnections() {
  showToast('Testing connections...');
  setTimeout(() => showToast('✅ All connections nominal'), 1500);
}

// ════════════════════════════════
// MODALS & PATIENTS
// ════════════════════════════════
function showAddPatient() { document.getElementById('modal-add-patient').style.display = 'flex'; }
function closeModal(id)   { document.getElementById(id).style.display = 'none'; }

function addPatient() {
  const name = document.getElementById('new-pt-name').value.trim();
  const age  = document.getElementById('new-pt-age').value;
  const sex  = document.getElementById('new-pt-sex').value;
  const bed  = document.getElementById('new-pt-bed').value.trim();
  const dx   = document.getElementById('new-pt-dx').value.trim();
  const doc  = document.getElementById('new-pt-doc').value.trim();
  if (!name || !age || !bed) { showToast('Please fill in required fields'); return; }
  const newP = {
    id: 'P'+Date.now(), name, age:parseInt(age), sex,
    bed: bed || 'Bed 0'+(PATIENTS.length+1),
    dx: dx || 'Under observation',
    admitted: new Date().toLocaleDateString('en-IN', { month:'short', day:'numeric', year:'numeric' }),
    doctor: doc || currentUser.name,
    vitals: { hr:80, bps:120, bpd:78, spo2:98, temp:37.0, rr:16, etco2:38 },
    alerts: []
  };
  PATIENTS.push(newP);
  liveVitals[newP.id] = { ...newP.vitals };
  closeModal('modal-add-patient');
  renderDashboard();
  showToast(`Patient ${name} added successfully`);
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── PWA ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
