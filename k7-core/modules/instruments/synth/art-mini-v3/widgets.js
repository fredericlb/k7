// Mini V3 screens: the oscillator mix, the ladder filter's curve, and the two contours.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = FONT;
  ctx.textBaseline = "top";
}

function lastPeak(arr) {
  return Array.isArray(arr) && arr.length ? Math.min(1, Math.max(0, arr[arr.length - 1] || 0)) : 0;
}

// One sample of a Mini waveform at phase p (0..1), from the 6-step wave switch value.
function wave(sel, p) {
  const i = Math.round((sel ?? 0.4) * 5);
  if (i === 0) return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  if (i === 1) return 0.5 * (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) + 0.5 * (1 - 2 * p);
  if (i === 2) return 1 - 2 * p;
  const duty = i === 3 ? 0.5 : i === 4 ? 0.3 : 0.12;
  return p < duty ? 1 : -1;
}

// Cycles drawn across the screen for a footage switch: 8' draws two, each octave doubles or halves.
function cycles(range, steps, eightIdx) {
  const idx = Math.round((range ?? 0.6) * steps);
  return Math.max(0.25, 2 * Math.pow(2, idx - eightIdx));
}

function envPath(ctx, x0, y0, w, h, a, d, s) {
  const ta = 0.05 + a * 0.3, td = 0.05 + d * 0.3, hold = 0.2;
  const total = ta + td + hold + td;
  const sx = w / total;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h);
  ctx.lineTo(x0 + ta * sx, y0);
  let x = x0 + ta * sx;
  for (let k = 1; k <= 12; k++) ctx.lineTo(x + (td * sx * k) / 12, y0 + h - h * (s + (1 - s) * Math.exp((-4 * k) / 12)));
  x += td * sx;
  ctx.lineTo(x + hold * sx, y0 + h - h * s);
  x += hold * sx;
  for (let k = 1; k <= 12; k++) ctx.lineTo(x + (td * sx * k) / 12, y0 + h - h * s * Math.exp((-4 * k) / 12));
  ctx.stroke();
}

export default {
  osc_screen(lcd) {
    const { ctx, width: W, height: H, params: P, output } = lcd;
    glass(ctx, W, H);
    const oscs = [
      { w: P["Wave Osc1"], lv: P["Level Osc1"] ?? 0.5, c: cycles(P["Range Osc1"], 5, 3), col: WHITE },
      { w: P["Wave Osc2"], lv: P["Level Osc2"] ?? 0.5, c: cycles(P["Range Osc2"], 5, 3) * (1 + ((P["Fine Osc2"] ?? 0.5) - 0.5) * 0.1), col: BLUE },
      { w: P["Wave Osc3"], lv: P["Level Osc3"] ?? 0.5, c: cycles(P["Range Osc3"], 6, 4) * (1 + ((P["Fine Osc3"] ?? 0.5) - 0.5) * 0.1), col: GREEN },
    ];
    const noise = P["Level Noise"] ?? 0;
    const mid = H / 2 + 4, amp = H / 2 - 8;
    const sumLv = oscs.reduce((t, o) => t + o.lv, 0) + noise * 0.5 || 1;
    for (const o of oscs) {
      if (o.lv < 0.02) continue;
      ctx.strokeStyle = o.col;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const y = mid - wave(o.w, ((x / W) * o.c) % 1) * amp * o.lv;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 1) {
      let v = 0;
      for (const o of oscs) v += wave(o.w, ((x / W) * o.c) % 1) * o.lv;
      v += noise * 0.5 * Math.sin(x * 12.9898 + 78.233 * x * x) * 0.6;
      const y = mid - (v / sumLv) * amp;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    const labels = [["O1", WHITE, oscs[0].lv], ["O2", BLUE, oscs[1].lv], ["O3", GREEN, oscs[2].lv], ["N", GREY, noise]];
    labels.forEach(([t, c, v], i) => {
      ctx.fillStyle = c;
      ctx.fillText(t, 4 + i * 30, 2);
      ctx.fillRect(16 + i * 30, 4, Math.max(1, 10 * v), 3);
    });
    const pk = lastPeak(output);
    ctx.fillStyle = ORANGE;
    ctx.fillRect(W - 4, H - pk * (H - 4), 3, pk * (H - 4));
  },

  filt_screen(lcd) {
    const { ctx, width: W, height: H, params: P, output, state } = lcd;
    glass(ctx, W, H);
    const cut = P["CutOff"] ?? 0.5, emph = P["Emphasis"] ?? 0.5, env = P["Amount"] ?? 0.5;
    const pk = lastPeak(output);
    state.mov = (state.mov ?? 0) * 0.7 + pk * 0.3;
    const fc = Math.min(0.98, cut + env * state.mov * 0.25);
    const top = 10, bot = H - 3;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, bot - (bot - top) * 0.6);
    ctx.lineTo(W, bot - (bot - top) * 0.6);
    ctx.stroke();
    const curve = (c, col) => {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const r = x / W - c;
        const peak = emph * 1.6 * Math.exp(-(r * r) / 0.0012);
        const roll = r > 0 ? Math.min(1, r * 6) : 0;
        const g = Math.max(0, (1 - roll) * 0.6 + peak * (1 - roll * 0.5));
        const y = Math.max(top, bot - (bot - top) * Math.min(1, g));
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    if (state.mov > 0.01) curve(fc, BLUE);
    curve(cut, ORANGE);
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(cut * W, bot - (bot - top) * Math.min(1, 0.6 + emph * 0.4), 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = WHITE;
    ctx.fillText("VCF 24DB", 3, 1);
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params: P } = lcd;
    glass(ctx, W, H);
    const top = 11, h = H - top - 3;
    ctx.strokeStyle = ORANGE;
    envPath(ctx, 2, top, W - 4, h, P["VCF Attack"] ?? 0.5, P["VCF Decay"] ?? 0.5, P["VCF Sustain"] ?? 0.5);
    ctx.strokeStyle = GREEN;
    envPath(ctx, 2, top, W - 4, h, P["VCA Attack"] ?? 0.5, P["VCA Decay"] ?? 0.5, P["VCA Sustain"] ?? 0.5);
    ctx.fillStyle = ORANGE;
    ctx.fillText("FILT", 3, 1);
    ctx.fillStyle = GREEN;
    ctx.fillText("AMP", 30, 1);
  },
};
