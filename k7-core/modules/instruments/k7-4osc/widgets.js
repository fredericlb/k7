// 4osc screens: the four oscillator waves, the filter response, the envelopes, the LFOs and the FX tails.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const SHAPES = ["OFF", "SINE", "TRI", "SAW+", "SAW-", "SQR", "RND"];

function clear(lcd) {
  lcd.ctx.fillStyle = "#000";
  lcd.ctx.fillRect(0, 0, lcd.width, lcd.height);
}

function text(ctx, s, x, y, c, align) {
  ctx.fillStyle = c;
  ctx.font = FONT;
  ctx.textAlign = align || "left";
  ctx.fillText(s, x, y);
}

// One sample of a 4OSC wave shape at phase ph (0..1), pulse width pw.
function wave(shape, ph, pw) {
  const p = ph - Math.floor(ph);
  switch (Math.round(shape)) {
    case 1: return Math.sin(2 * Math.PI * p);
    case 2: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 3: return 2 * p - 1;
    case 4: return 1 - 2 * p;
    case 5: return p < pw ? 1 : -1;
    case 6: { const k = Math.floor(ph * 6); const h = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return 2 * (h - Math.floor(h)) - 1; }
    default: return 0;
  }
}

function plotWave(ctx, shape, x, y, w, h, amp, cycles, pw, offset, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const n = Math.max(2, Math.floor(w));
  for (let i = 0; i <= n; i++) {
    const v = wave(shape, (i / n) * cycles + offset, pw);
    const px = x + (i / n) * w, py = y + h / 2 - v * amp * (h / 2);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// Seconds onto a compressed axis so 1 ms and 60 s both read.
const tx = (t) => Math.log10(1 + Math.max(0, t) * 20);

function adsr(ctx, a, d, s, r, x, y, w, h, scale, col) {
  const hold = 0.6;
  const xa = x + (tx(a) / scale) * w, xd = xa + (tx(d) / scale) * w;
  const xs = xd + (hold / scale) * w, xr = xs + (tx(r) / scale) * w;
  const ys = y + h - s * h;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(xa, y);
  ctx.lineTo(xd, ys);
  ctx.lineTo(xs, ys);
  ctx.lineTo(xr, y + h);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(xa, y, 2, 0, 2 * Math.PI);
  ctx.fill();
}

const envScale = (...sets) => Math.max(1, ...sets.map(([a, d, r]) => tx(a) + tx(d) + 0.6 + tx(r))) * 1.05;

function peak(arr) {
  if (!arr || !arr.length) return 0;
  let m = 0;
  for (let i = Math.max(0, arr.length - 16); i < arr.length; i++) m = Math.max(m, arr[i] || 0);
  return m;
}

export default {
  osc_screen(lcd) {
    clear(lcd);
    const { ctx, width: W, height: H, params: p } = lcd;
    const lane = H / 4;
    for (let i = 1; i <= 4; i++) {
      const y = (i - 1) * lane;
      const shape = p[`Wave Shape ${i}`] ?? (i === 1 ? 3 : 0);
      const lvl = Math.pow(10, (p[`Level ${i}`] ?? 0) / 20);
      const pw = p[`Pulse Width ${i}`] ?? 0.5;
      const tune = Math.round(p[`Tune ${i}`] ?? 0);
      const voices = Math.max(1, Math.round(p[`Voices ${i}`] ?? 1));
      const det = p[`Detune ${i}`] ?? 0;
      const on = Math.round(shape) > 0;
      if (i > 1) { ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0, y, W, 1); }
      const top = y + 11, h = lane - 15;
      const cycles = Math.min(6, 2 * Math.pow(2, tune / 24));
      if (!on) {
        ctx.strokeStyle = GREY;
        ctx.beginPath(); ctx.moveTo(4, top + h / 2); ctx.lineTo(W - 4, top + h / 2); ctx.stroke();
      } else {
        for (let v = 1; v < Math.min(voices, 4); v++)
          plotWave(ctx, shape, 4, top, W - 8, h, lvl * 0.9, cycles * (1 + det * 0.15 * v), pw, v * det * 0.4, GREY);
        plotWave(ctx, shape, 4, top, W - 8, h, lvl * 0.9, cycles, pw, 0, BLUE);
      }
      text(ctx, `${i} ${SHAPES[Math.round(shape)] || "?"}`, 4, y + 9, on ? WHITE : GREY);
      const t = `${tune > 0 ? "+" : ""}${tune}${voices > 1 ? ` x${voices}` : ""}`;
      text(ctx, t, W - 4, y + 9, on ? WHITE : GREY, "right");
    }
  },

  filter_screen(lcd) {
    clear(lcd);
    const { ctx, width: W, height: H, params: p } = lcd;
    const type = Math.round(p["Filter Type"] ?? 1);
    const note = p["Filter Freq"] ?? 69;
    const fc = 440 * Math.pow(2, (note - 69) / 12);
    const q = 0.707 + ((p["Filter Resonance"] ?? 0.5) / 100) * 12;
    const steep = (p["Filter Slope"] ?? 12) >= 24 ? 2 : 1;
    const amt = p["Filter Amount"] ?? 0;
    const fx = (f) => (Math.log10(f / 20) / 3) * W;
    const dbY = (db) => 4 + ((18 - Math.max(-42, Math.min(18, db))) / 60) * (H - 8);
    const mag = (f, c) => {
      const w = f / c, re = 1 - w * w, im = w / q, den = Math.sqrt(re * re + im * im) || 1e-9;
      let m = 1;
      if (type === 1) m = 1 / den;
      else if (type === 2) m = (w * w) / den;
      else if (type === 3) m = (w / q) / den;
      else if (type === 4) m = Math.abs(1 - w * w) / den;
      return 20 * Math.log10(Math.pow(Math.max(m, 1e-6), steep));
    };
    ctx.strokeStyle = "#1a1a1a";
    ctx.beginPath(); ctx.moveTo(0, dbY(0)); ctx.lineTo(W, dbY(0)); ctx.stroke();
    const curve = (c, col) => {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const f = 20 * Math.pow(1000, x / W), y = dbY(type === 0 ? 0 : mag(f, c));
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    if (type !== 0 && Math.abs(amt) > 0.01) curve(Math.min(20000, Math.max(20, fc * Math.pow(2, amt * 5))), GREY);
    curve(fc, type === 0 ? GREY : ORANGE);
    if (type !== 0) {
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.arc(fx(Math.min(20000, Math.max(20, fc))), dbY(mag(fc, fc)), 2.5, 0, 2 * Math.PI); ctx.fill();
    }
    const hz = fc >= 1000 ? `${(fc / 1000).toFixed(1)}K` : `${Math.round(fc)}`;
    text(ctx, ["OFF", "LP", "HP", "BP", "NOTCH"][type] || "", 4, 10, WHITE);
    text(ctx, type === 0 ? "" : hz, W - 4, 10, ORANGE, "right");
  },

  env_screen(lcd) {
    clear(lcd);
    const { ctx, width: W, height: H, params: p, output } = lcd;
    const amp = [p["Amp Attack"] ?? 0.1, p["Amp Decay"] ?? 0.1, p["Amp Release"] ?? 0.1];
    const flt = [p["Filter Attack"] ?? 0.1, p["Filter Decay"] ?? 0.1, p["Filter Release"] ?? 0.1];
    const sc = envScale(amp, flt);
    const amt = p["Filter Amount"] ?? 0;
    const x = 6, y = 14, w = W - 12, h = H - 22;
    if (Math.abs(amt) > 0.01) adsr(ctx, flt[0], flt[1], (p["Filter Sustain"] ?? 80) / 100, flt[2], x, y + h * (1 - Math.abs(amt)), w, h * Math.abs(amt), sc, ORANGE);
    else adsr(ctx, flt[0], flt[1], (p["Filter Sustain"] ?? 80) / 100, flt[2], x, y, w, h, sc, GREY);
    adsr(ctx, amp[0], amp[1], (p["Amp Sustain"] ?? 80) / 100, amp[2], x, y, w, h, sc, WHITE);
    const lv = peak(output);
    if (lv > 0.001) { ctx.fillStyle = GREEN; ctx.fillRect(W - 4, y + h - lv * h, 2, lv * h); }
    text(ctx, "AMP", 4, 9, WHITE);
    text(ctx, "FLT", 28, 9, Math.abs(amt) > 0.01 ? ORANGE : GREY);
  },

  mod_screen(lcd) {
    clear(lcd);
    const { ctx, width: W, height: H, params: p, now } = lcd;
    const half = H / 2;
    const lfos = [[1, BLUE], [2, GREEN]];
    for (const [i, col] of lfos) {
      const y = 12 + (i - 1) * (half / 2 - 4), h = half / 2 - 14;
      const shape = p[`LFO Shape ${i}`] ?? 0;
      const rate = p[`Rate ${i}`] ?? 1;
      const depth = p[`Depth ${i}`] ?? 1;
      const cycles = Math.max(0.5, Math.min(8, 1 + Math.log2(1 + rate)));
      const on = Math.round(shape) > 0;
      const ph = on ? ((now || 0) / 1000) * Math.min(rate, 4) * 0.25 : 0;
      if (on) plotWave(ctx, shape, 30, y, W - 34, h, Math.max(0.05, depth), cycles, 0.5, -ph, col);
      else { ctx.strokeStyle = GREY; ctx.beginPath(); ctx.moveTo(30, y + h / 2); ctx.lineTo(W - 4, y + h / 2); ctx.stroke(); }
      text(ctx, `LFO${i}`, 4, y + h / 2 + 3, on ? col : GREY);
    }
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, half, W, 1);
    const m1 = [p["Mod Attack 1"] ?? 0.1, p["Mod Decay 1"] ?? 0.1, p["Mod Release 1"] ?? 0.1];
    const m2 = [p["Mod Attack 2"] ?? 0.1, p["Mod Decay 2"] ?? 0.1, p["Mod Release 2"] ?? 0.1];
    const sc = envScale(m1, m2);
    const y = half + 16, h = half - 24;
    adsr(ctx, m2[0], m2[1], (p["Mod Sustain 2"] ?? 80) / 100, m2[2], 6, y, W - 12, h, sc, GREEN);
    adsr(ctx, m1[0], m1[1], (p["Mod Sustain 1"] ?? 80) / 100, m1[2], 6, y, W - 12, h, sc, BLUE);
    text(ctx, "MOD1", 4, half + 10, BLUE);
    text(ctx, "MOD2", 34, half + 10, GREEN);
  },

  fx_screen(lcd) {
    clear(lcd);
    const { ctx, width: W, height: H, params: p } = lcd;
    const half = H / 2;
    const dOn = (p["Delay On"] ?? 0) >= 0.5;
    const time = Math.max(0.05, p["Delay"] ?? 1);
    const fb = Math.pow(10, (p["Feedback"] ?? -10) / 20);
    const dMix = p["Mix #2"] ?? 0;
    const base = half - 6, top = 14;
    ctx.fillStyle = WHITE;
    ctx.fillRect(4, top, 3, base - top);
    const step = Math.max(4, ((W - 12) / 4) * (time / 1));
    let a = Math.max(0.08, dMix);
    for (let x = 4 + step, k = 0; x < W - 4 && k < 32; x += step, k++) {
      const h = (base - top) * a;
      ctx.fillStyle = dOn ? GREEN : GREY;
      ctx.fillRect(x, base - h, 3, h);
      a *= fb;
      if (a < 0.01) break;
    }
    text(ctx, "DELAY", 4, 9, dOn ? GREEN : GREY);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, half, W, 1);
    const rOn = (p["Reverb On"] ?? 0) >= 0.5;
    const size = p["Size"] ?? 0;
    const damp = p["Damping"] ?? 0;
    const rMix = Math.max(0.08, p["Mix #3"] ?? 0);
    const rb = H - 4, rt = half + 14, len = (W - 8) * (0.15 + 0.85 * size);
    ctx.fillStyle = rOn ? WHITE : GREY;
    ctx.beginPath();
    ctx.moveTo(4, rb);
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, env = Math.exp(-t * (3 + damp * 3)) * (1 - t);
      ctx.lineTo(4 + t * len, rb - env * (rb - rt) * rMix);
    }
    ctx.lineTo(4 + len, rb);
    ctx.closePath();
    ctx.fill();
    text(ctx, "REVERB", 4, half + 10, rOn ? WHITE : GREY);
    const dist = (p["Distortion On"] ?? 0) >= 0.5, chor = (p["Chorus On"] ?? 0) >= 0.5;
    text(ctx, "DIST", W - 4, 9, dist ? RED : GREY, "right");
    text(ctx, "CHO", W - 34, 9, chor ? BLUE : GREY, "right");
  },
};
