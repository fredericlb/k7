// Screens for the CS-80 V4 panel: one per channel (wave, filter band, both envelopes) and the LFO / ring page.
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const WHITE = "#ffffff";
const GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const on = (p, n) => (p[n] ?? 0) >= 0.5;
// Deterministic pseudo-noise so a redraw never flickers without a reason.
const hash = (i) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

function oscSample(p, n, t) {
  const ph = t - Math.floor(t);
  const pw = 0.5 + 0.45 * (p[`VCO${n} Pulse Width`] ?? 0);
  let s = 0;
  let k = 0;
  if (on(p, `VCO${n} Saw Osc`)) { s += 1 - 2 * ph; k++; }
  if (on(p, `VCO${n} Square Osc`)) { s += ph < pw ? 1 : -1; k++; }
  if (on(p, `VCO${n} Tri Osc`)) { s += ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; k++; }
  const sine = p[`VCA${n} Sine Level`] ?? 0;
  s += sine * Math.sin(2 * Math.PI * ph);
  k += sine;
  const noise = p[`VCO${n} Noise Level`] ?? 0;
  s += noise * hash(Math.floor(t * 64)) * 0.8;
  k += noise * 0.8;
  return k > 0 ? s / k : 0;
}

// A 2-pole response in dB at normalised frequency x (0..1 across the audio band).
function response(x, cut, res, high) {
  const r = Math.pow(2, (x - cut) * 10);
  const q = 0.7 + res * 6;
  const rr = high ? 1 / r : r;
  const mag = 1 / Math.sqrt((1 - rr * rr) * (1 - rr * rr) + (rr / q) * (rr / q));
  return 20 * Math.log10(Math.max(1e-6, mag));
}

function envPath(ctx, pts, x0, y0, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  pts.forEach(([t, v], i) => {
    const x = x0 + t * w;
    const y = y0 + h - v * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function channel(lcd, n) {
  const { ctx, width: W, height: H, params: p } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const half = Math.floor(W / 2);
  const topH = Math.floor(H * 0.48);
  // Oscillator: two cycles of the mixed wave.
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const ow = half - 10;
  for (let px = 0; px <= ow; px++) {
    const y = 12 + (topH - 16) / 2 - oscSample(p, n, (px / Math.max(1, ow)) * 2) * ((topH - 16) / 2);
    if (px === 0) ctx.moveTo(4 + px, y);
    else ctx.lineTo(4 + px, y);
  }
  ctx.stroke();
  ctx.fillStyle = GREY;
  ctx.fillText("VCO", 4, 9);
  // Filter: the band the HPF and LPF leave open.
  const fx = half + 4;
  const fw = W - fx - 4;
  const hpOn = on(p, `VCF${n} HPF ON/OFF`);
  const lpOn = on(p, `VCF${n} LPF ON/OFF`);
  const hc = p[`VCF${n} HPF Cutoff`] ?? 0;
  const hr = p[`VCF${n} HPF Resonance`] ?? 0;
  const lc = p[`VCF${n} LPF Cutoff`] ?? 1;
  const lr = p[`VCF${n} LPF Resonance`] ?? 0;
  const fy = 12;
  const fh = topH - 16;
  const zero = fy + fh * 0.35;
  ctx.strokeStyle = GREY;
  ctx.beginPath();
  ctx.moveTo(fx, zero + 0.5);
  ctx.lineTo(fx + fw, zero + 0.5);
  ctx.stroke();
  ctx.strokeStyle = ORANGE;
  ctx.beginPath();
  for (let px = 0; px <= fw; px++) {
    const x = px / Math.max(1, fw);
    let db = 0;
    if (hpOn) db += response(x, hc, hr, true);
    if (lpOn) db += response(x, lc, lr, false);
    const y = clamp(zero - (db / 18) * (fh * 0.35), fy, fy + fh);
    if (px === 0) ctx.moveTo(fx + px, y);
    else ctx.lineTo(fx + px, y);
  }
  ctx.stroke();
  ctx.fillStyle = GREY;
  ctx.fillText(`${hpOn ? "HP" : "--"} ${lpOn ? "LP" : "--"}`, fx, 9);
  // Envelopes: the filter's IL > peak > 0 > back to IL, and the amp's ADSR.
  const ey = topH + 10;
  const eh = H - ey - 4;
  if (eh > 6) {
    const fa = 0.04 + (p[`VCF Envelope${n} Attack Classic`] ?? 0) * 0.26;
    const fd = 0.04 + (p[`VCF Envelope${n} Decay Classic`] ?? 0) * 0.26;
    const fr = 0.04 + (p[`VCF Envelope${n} Release Classic`] ?? 0) * 0.26;
    const il = p[`VCF Envelope${n} Initial Level`] ?? 0;
    const al = p[`VCF Envelope${n} Attack Level`] ?? 0;
    const hold = 0.66;
    envPath(ctx, [[0, il], [fa, al], [Math.min(hold, fa + fd), 0], [hold, 0], [Math.min(1, hold + fr), il]], 4, ey, W - 8, eh, GREEN);
    const aa = 0.04 + (p[`VCA Envelope${n} Attack Classic`] ?? 0) * 0.26;
    const ad = 0.04 + (p[`VCA Envelope${n} Decay Classic`] ?? 0) * 0.26;
    const as = p[`VCA Envelope${n} Sustain Level`] ?? 1;
    const ar = 0.04 + (p[`VCA Envelope${n} Release Classic`] ?? 0) * 0.3;
    const lvl = p[`VCA${n} Level`] ?? 1;
    envPath(ctx, [[0, 0], [aa, lvl], [Math.min(hold, aa + ad), as * lvl], [hold, as * lvl], [Math.min(1, hold + ar), 0]], 4, ey, W - 8, eh, WHITE);
    ctx.strokeStyle = GREY;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(4 + hold * (W - 8) + 0.5, ey);
    ctx.lineTo(4 + hold * (W - 8) + 0.5, ey + eh);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = GREEN;
    ctx.fillText("F.EG", 4, ey - 2);
    ctx.fillStyle = WHITE;
    ctx.fillText("A.EG", 32, ey - 2);
  }
  ctx.fillStyle = WHITE;
  ctx.textAlign = "right";
  ctx.fillText(n === 1 ? "I" : "II", W - 4, 9);
  ctx.textAlign = "left";
}

function lfoShape(wave, ph, i) {
  if (wave < 0.1) return hash(i);
  if (wave < 0.3) return hash(Math.floor(ph * 97));
  if (wave < 0.5) return ph - Math.floor(ph) < 0.5 ? 1 : -1;
  if (wave < 0.7) return 2 * (ph - Math.floor(ph)) - 1;
  if (wave < 0.9) return 1 - 2 * (ph - Math.floor(ph));
  return Math.sin(2 * Math.PI * ph);
}

function lfo_screen(lcd) {
  const { ctx, width: W, height: H, params: p, now } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const wave = p["Sub Oscillator Waveform"] ?? 1;
  const rate = p["Sub Oscillator Rate Unsynced"] ?? 0.5;
  const cycles = 1 + rate * 7;
  const drift = ((now ?? 0) / 1000) * (0.2 + rate) % 1;
  const barsW = 54;
  const lw = W - barsW - 12;
  const lh = Math.floor(H * 0.55);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = 0; px <= lw; px++) {
    const ph = (px / Math.max(1, lw)) * cycles + drift;
    const v = lfoShape(wave, ph, Math.floor(ph));
    const y = 12 + lh / 2 - v * (lh / 2 - 4);
    if (px === 0) ctx.moveTo(4 + px, y);
    else ctx.lineTo(4 + px, y);
  }
  ctx.stroke();
  ctx.fillStyle = GREY;
  ctx.fillText("LFO", 4, 9);
  // Where the LFO goes: one bar per destination.
  const dest = [["VCO", p["Sub Oscillator VCO"] ?? 1, BLUE], ["VCF", p["Sub Oscillator VCF"] ?? 1, ORANGE], ["VCA", p["Sub Oscillator VCA"] ?? 1, WHITE]];
  const bx0 = W - barsW - 4;
  const slot = barsW / 3;
  dest.forEach(([name, v, c], i) => {
    const x = bx0 + i * slot + 3;
    const bh = clamp(v, 0, 1) * (lh - 4);
    ctx.strokeStyle = GREY;
    ctx.strokeRect(x + 0.5, 12.5, slot - 7, lh - 4);
    ctx.fillStyle = c;
    ctx.fillRect(x, 12 + lh - 4 - bh, slot - 6, bh);
    ctx.fillStyle = GREY;
    ctx.fillText(name, x - 1, 9);
  });
  // Ring modulator: its speed inside the attack/decay envelope that shapes its depth.
  const ry = lh + 22;
  const rh = H - ry - 4;
  if (rh > 6) {
    const ra = 0.03 + (p["Ring Modulator Attack"] ?? 1) * 0.4;
    const rd = 0.03 + (p["Ring Modulator Decay"] ?? 1) * 0.55;
    const depth = p["Ring Modulator Depth"] ?? 1;
    const speed = 3 + (p["Ring Modulator Speed"] ?? 0.3) * 40;
    const rw = W - 8;
    const env = (x) => (x < ra ? x / ra : Math.max(0, 1 - (x - ra) / rd)) * depth;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    for (let px = 0; px <= rw; px++) {
      const x = px / Math.max(1, rw);
      const y = ry + rh / 2 - env(x) * (rh / 2);
      if (px === 0) ctx.moveTo(4 + px, y);
      else ctx.lineTo(4 + px, y);
    }
    ctx.stroke();
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    for (let px = 0; px <= rw; px++) {
      const x = px / Math.max(1, rw);
      const y = ry + rh / 2 - env(x) * Math.sin(2 * Math.PI * speed * x) * (rh / 2);
      if (px === 0) ctx.moveTo(4 + px, y);
      else ctx.lineTo(4 + px, y);
    }
    ctx.stroke();
    ctx.fillStyle = GREY;
    ctx.fillText("RING", 4, ry - 4);
  }
}

export default {
  c1_screen(lcd) { channel(lcd, 1); },
  c2_screen(lcd) { channel(lcd, 2); },
  lfo_screen,
};
