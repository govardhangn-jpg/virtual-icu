// ── Vitals Engine ──

function getVitalStatus(key, value) {
  const t = THRESHOLDS[key];
  if (!t) return 'normal';
  if (t.critLo && value <= t.critLo) return 'critical';
  if (t.critHi && value >= t.critHi) return 'critical';
  if (t.warnLo && value <= t.warnLo) return 'warning';
  if (t.warnHi && value >= t.warnHi) return 'warning';
  return 'normal';
}

function getPatientStatus(pid) {
  const v = liveVitals[pid];
  const checks = [
    getVitalStatus('hr', v.hr),
    getVitalStatus('bps', v.bps),
    getVitalStatus('spo2', v.spo2),
    getVitalStatus('temp', v.temp),
    getVitalStatus('rr', v.rr),
    getVitalStatus('etco2', v.etco2)
  ];
  if (checks.includes('critical')) return 'critical';
  if (checks.includes('warning')) return 'warning';
  return 'normal';
}

// ── Simulate fluctuating vitals ──
function simulateVitals() {
  PATIENTS.forEach(p => {
    const base = p.vitals;
    const v = liveVitals[p.id];

    // Gentle random walk
    v.hr    = clamp(v.hr    + rand(-1.2, 1.2), base.hr - 15, base.hr + 20);
    v.bps   = clamp(v.bps   + rand(-1.5, 1.5), base.bps - 20, base.bps + 25);
    v.bpd   = clamp(v.bpd   + rand(-1, 1),   base.bpd - 12, base.bpd + 15);
    v.spo2  = clamp(v.spo2  + rand(-0.4, 0.4), Math.max(base.spo2 - 5, 80), 100);
    v.temp  = clamp(v.temp  + rand(-0.06, 0.06), base.temp - 0.5, base.temp + 0.6);
    v.rr    = clamp(v.rr    + rand(-0.8, 0.8), base.rr - 5, base.rr + 8);
    v.etco2 = clamp(v.etco2 + rand(-0.7, 0.7), base.etco2 - 6, base.etco2 + 8);

    // Auto-generate alerts for critical drift
    const status = getPatientStatus(p.id);
    if (status === 'critical') {
      const msg = buildCriticalMessage(p.id);
      if (msg && Math.random() < 0.03) {
        addGlobalAlert('critical', p.name, p.bed, msg);
      }
    }
  });
}

function buildCriticalMessage(pid) {
  const v = liveVitals[pid];
  if (v.spo2 < 90) return `SpO₂ critically low at ${v.spo2.toFixed(0)}%`;
  if (v.bps < 70)  return `BP critically low: ${v.bps.toFixed(0)}/${v.bpd.toFixed(0)} mmHg`;
  if (v.hr > 130)  return `Tachycardia: HR ${v.hr.toFixed(0)} bpm`;
  if (v.hr < 40)   return `Bradycardia: HR ${v.hr.toFixed(0)} bpm`;
  if (v.temp > 39.5) return `High fever: ${v.temp.toFixed(1)}°C`;
  if (v.rr > 30)   return `Resp. distress: RR ${v.rr.toFixed(0)}/min`;
  return null;
}

function addGlobalAlert(level, patientName, bed, msg) {
  const now = new Date();
  const t = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const vital = msg.split(':')[1]?.trim() || '';
  globalAlerts.unshift({
    id: 'A' + Date.now(),
    level, patient: patientName, bed, msg,
    vital, time: t, acked: false
  });
  if (globalAlerts.length > 30) globalAlerts = globalAlerts.slice(0, 30);
  updateAlertCount();
}

function updateAlertCount() {
  const unacked = globalAlerts.filter(a => !a.acked && a.level !== 'info').length;
  document.getElementById('alert-nav-count').textContent = unacked;
  document.getElementById('header-alert-badge').textContent = unacked;

  // Show critical banner if any critical unacked
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

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

// ── ECG Generation ──
function generateECGPoint(t) {
  const cycle = ((t % 1) + 1) % 1;
  if (cycle < 0.08) return 0.5 + Math.sin(cycle / 0.08 * Math.PI) * 0.06;
  if (cycle < 0.10) return 0.5 - 0.12;
  if (cycle < 0.13) return 0.5 + 0.88;
  if (cycle < 0.15) return 0.5 - 0.22;
  if (cycle < 0.20) return 0.5 + 0.10;
  if (cycle < 0.42) return 0.5 + Math.sin((cycle - 0.20) / 0.22 * Math.PI) * 0.20;
  if (cycle < 0.52) return 0.5 + Math.sin((cycle - 0.42) / 0.10 * Math.PI) * 0.08;
  return 0.5;
}

// ── ECG Waveform Manager ──
class ECGWaveform {
  constructor(canvas, color = '#ff4d4d', isCritical = false) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = color;
    this.isCritical = isCritical;
    this.data = [];
    this.t = Math.random() * 10;
    this.speed = 0.009;
    this.running = false;
    this.rafId = null;
    this.resize();
  }

  resize() {
    const w = this.canvas.parentElement?.offsetWidth || 400;
    this.canvas.width = w;
    while (this.data.length < w) this.data.push(generateECGPoint(this.t));
  }

  start() {
    this.running = true;
    this.draw();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  draw() {
    if (!this.running) return;
    this.t += this.speed;
    this.data.shift();
    const noise = this.isCritical ? (Math.random() - 0.5) * 0.04 : 0;
    this.data.push(generateECGPoint(this.t) + noise);

    const { canvas, ctx, color, data } = this;
    const h = canvas.height;
    ctx.clearRect(0, 0, canvas.width, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = i;
      const y = data[i] * (h - 8) + 4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    this.rafId = requestAnimationFrame(() => this.draw());
  }
}

// ── Trend Data Generator ──
function generateTrendData(baseVal, points = 48, variance = 0.08) {
  const data = [];
  let v = baseVal;
  for (let i = 0; i < points; i++) {
    v = v + (baseVal - v) * 0.1 + (Math.random() - 0.5) * baseVal * variance;
    data.push(+v.toFixed(1));
  }
  return data;
}

function generateTrendLabels(hours = 24, points = 48) {
  const labels = [];
  const now = new Date();
  const step = (hours * 60) / points;
  for (let i = points - 1; i >= 0; i--) {
    const t = new Date(now - i * step * 60000);
    labels.push(t.getHours().toString().padStart(2,'0') + ':' +
                t.getMinutes().toString().padStart(2,'0'));
  }
  return labels;
}
