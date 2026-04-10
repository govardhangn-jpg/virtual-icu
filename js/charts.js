// ── Chart Rendering ──

function drawTrendChart(canvasId, labels, data, color, thresholdHi, thresholdLo) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.offsetWidth - 40;
  const H = 120;
  canvas.width = W; canvas.height = H;
  const PAD = { top: 10, right: 10, bottom: 24, left: 38 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  const minV = Math.min(...data) * 0.95;
  const maxV = Math.max(...data) * 1.05;

  const toX = i => PAD.left + (i / (data.length - 1)) * cw;
  const toY = v => PAD.top + ch - ((v - minV) / (maxV - minV)) * ch;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (i / 4) * ch;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cw, y); ctx.stroke();
    const val = maxV - (i / 4) * (maxV - minV);
    ctx.fillStyle = 'rgba(139,149,176,0.6)';
    ctx.font = '9px Space Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(0), PAD.left - 4, y + 3);
  }

  // Threshold bands
  if (thresholdHi) {
    const ty = toY(thresholdHi);
    ctx.strokeStyle = 'rgba(245,158,11,0.3)';
    ctx.setLineDash([3,3]); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(PAD.left, ty); ctx.lineTo(PAD.left + cw, ty); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (thresholdLo) {
    const ty = toY(thresholdLo);
    ctx.strokeStyle = 'rgba(245,158,11,0.3)';
    ctx.setLineDash([3,3]); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(PAD.left, ty); ctx.lineTo(PAD.left + cw, ty); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Fill gradient
  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + ch);
  grad.addColorStop(0, color.replace(')', ', 0.2)').replace('rgb', 'rgba'));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = toX(i), y = toY(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(toX(data.length - 1), PAD.top + ch);
  ctx.lineTo(toX(0), PAD.top + ch);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.shadowBlur = 6; ctx.shadowColor = color;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = toX(i), y = toY(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // X labels (sparse)
  ctx.fillStyle = 'rgba(139,149,176,0.5)';
  ctx.font = '9px Space Mono, monospace';
  ctx.textAlign = 'center';
  const step = Math.floor(labels.length / 6);
  for (let i = 0; i < labels.length; i += step) {
    ctx.fillText(labels[i], toX(i), H - 4);
  }
}

let trendChartData = null;

function renderTrends() {
  const pid = document.getElementById('trend-patient-select')?.value;
  const p = PATIENTS.find(x => x.id === pid) || PATIENTS[0];
  const labels = generateTrendLabels(24, 48);

  trendChartData = {
    hr:   generateTrendData(p.vitals.hr, 48, 0.07),
    bps:  generateTrendData(p.vitals.bps, 48, 0.06),
    bpd:  generateTrendData(p.vitals.bpd, 48, 0.05),
    spo2: generateTrendData(Math.min(p.vitals.spo2, 99), 48, 0.015),
    temp: generateTrendData(p.vitals.temp, 48, 0.008)
  };

  setTimeout(() => {
    drawTrendChart('trend-hr',   labels, trendChartData.hr,   '#ff4d4d', 100, 60);
    drawTrendChart('trend-bp',   labels, trendChartData.bps,  '#3b82f6', 140, 90);
    drawTrendChart('trend-spo2', labels, trendChartData.spo2, '#00d4aa', null, 94);
    drawTrendChart('trend-temp', labels, trendChartData.temp, '#f59e0b', 38.3, 36.0);
  }, 50);
}
