// augmented-voices screens: layers A and B across the Morph fader with their filters, and the delay/reverb space.
const TITLE = "VOICES";
const BLUE = "#3d7dff";
const ORANGE = "#ff6a1a";
const RED = "#ff3b30";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const FONT = "8px ui-monospace, monospace";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

// Magnitude in dB of a 2-pole low-pass at normalized position f against cutoff c.
function lpDb(f, c, res) {
  const w = Math.pow(2, (f - c) * 9);
  const q = 0.7 + res * 9;
  const re = 1 - w * w;
  const im = w / q;
  return 20 * Math.log10(1 / Math.sqrt(re * re + im * im + 1e-9) + 1e-9) * 1.6;
}

function curve(ctx, x0, y0, w, h, c, res, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= w; i += 2) {
    const db = clamp(lpDb(i / Math.max(w, 1), c, res), -36, 18);
    const y = y0 + ((18 - db) / 54) * h;
    if (i === 0) ctx.moveTo(x0 + i, y);
    else ctx.lineTo(x0 + i, y);
  }
  ctx.stroke();
}

export default {
  layers_screen(lcd) {
    const { ctx, width: W, height: H, params, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const p = (k, d) => clamp(num(params[k], d), 0, 1);
    const morph = p("Morph", 0.5);
    const volA = p("Layer A Volume", 0.67);
    const volB = p("Layer B Volume", 0.67);
    const pad = 6;
    const half = Math.max(20, H * 0.45);
    const cy = half * 0.55 + 4;
    const maxR = Math.max(3, Math.min(half * 0.4, W * 0.12));
    const ax = pad + maxR;
    const bx = W - pad - maxR;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(ax, cy + 0.5);
    ctx.lineTo(bx, cy + 0.5);
    ctx.stroke();
    const rA = Math.max(1.5, maxR * volA * (1 - morph * 0.8));
    const rB = Math.max(1.5, maxR * volB * (0.2 + morph * 0.8));
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.arc(ax, cy, rA, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(bx, cy, rB, 0, Math.PI * 2);
    ctx.fill();
    const lvl = Array.isArray(output) && output.length ? clamp(num(output[output.length - 1], 0), 0, 1) : 0;
    const mx = ax + (bx - ax) * morph;
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    ctx.arc(mx, cy, 3 + lvl * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.fillRect(mx - 1, cy - 1, 2, 2);
    ctx.font = FONT;
    ctx.fillStyle = BLUE;
    ctx.fillText("A", 2, 9);
    ctx.fillStyle = ORANGE;
    ctx.fillText("B", W - 8, 9);
    ctx.fillStyle = GREY;
    ctx.fillText(TITLE, Math.max(10, W / 2 - 14), 9);
    const fy = half + 6;
    const fh = Math.max(8, H - fy - 4);
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(pad, fy + (18 / 54) * fh + 0.5);
    ctx.lineTo(W - pad, fy + (18 / 54) * fh + 0.5);
    ctx.stroke();
    curve(ctx, pad, fy, W - pad * 2, fh, p("Layer A Filter Cutoff", 1), p("Layer A Filter Resonance", 0), BLUE);
    curve(ctx, pad, fy, W - pad * 2, fh, p("Layer B Filter Cutoff", 1), p("Layer B Filter Resonance", 0), ORANGE);
  },

  space_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const p = (k, d) => clamp(num(params[k], d), 0, 1);
    const dly = p("Delay", 0);
    const rev = p("Reverb", 0);
    const fb = p("Master Delay Feedback", 0.35);
    const time = p("Master Delay Time", 0.25);
    const decay = p("Master Reverb Decay", 0.5);
    const base = H - 3;
    const top = 12;
    const span = Math.max(4, base - top);
    const tail = Math.max(10, (0.15 + decay * 0.85) * (W - 8));
    ctx.fillStyle = RED;
    ctx.globalAlpha = 0.15 + rev * 0.6;
    ctx.beginPath();
    ctx.moveTo(4, base);
    for (let i = 0; i <= tail; i += 3) ctx.lineTo(4 + i, base - span * rev * Math.exp(-4 * i / tail));
    ctx.lineTo(4 + tail, base);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    const gap = Math.max(4, (0.08 + time * 0.4) * W);
    let amp = 1;
    ctx.fillStyle = WHITE;
    ctx.fillRect(4, top, 2, span);
    for (let x = 4 + gap, n = 0; x < W - 2 && n < 32; x += gap, n++) {
      const h = span * amp * dly;
      if (h >= 1) ctx.fillRect(Math.round(x), base - h, 2, h);
      amp *= 0.15 + fb * 0.8;
    }
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, base + 0.5);
    ctx.lineTo(W, base + 0.5);
    ctx.stroke();
    ctx.font = FONT;
    ctx.fillStyle = WHITE;
    ctx.fillText("DLY", 10, 9);
    ctx.fillStyle = RED;
    ctx.fillText("REV", 32, 9);
  },
};
