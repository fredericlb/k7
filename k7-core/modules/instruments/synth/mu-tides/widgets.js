// mu-tides screens — the slope's cycle with its shifted outputs, and the voice's ADSR.
const FONT = "8px ui-monospace, monospace";
const BLUE = "#3d7dff";
const ORANGE = "#ff6a1a";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const MODES = ["AMP", "PHASE", "FREQ"];

function num(p, k, d) {
  const v = p ? p[k] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.lineWidth = 1;
}

// Shape bends a 0..1 ramp: 0 exponential, 0.5 linear, 1 logarithmic.
function bend(u, shape) {
  const k = (shape - 0.5) * 2;
  return k >= 0 ? 1 - Math.pow(1 - u, 1 + 3 * k) : Math.pow(u, 1 - 3 * k);
}

// One cycle of the slope, sampled n times, before smoothing.
function cycle(n, slope, shape) {
  const rise = clamp(slope, 0.02, 0.98);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const ph = i / n;
    out[i] = ph < rise ? bend(ph / rise, shape) : bend(1 - (ph - rise) / (1 - rise), shape);
  }
  return out;
}

// Smoothness under 0.5 rounds the corners off, above 0.5 folds ripples into the wave.
function smooth(wave, sm) {
  const n = wave.length;
  if (n === 0) return wave;
  if (sm < 0.5) {
    const r = Math.floor((0.5 - sm) * 2 * n * 0.12);
    if (r < 1) return wave;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += wave[(i + j + n * 4) % n] ?? 0;
      out[i] = s / (2 * r + 1);
    }
    return out;
  }
  const f = (sm - 0.5) * 2;
  return wave.map((v) => clamp(v + f * 0.18 * Math.sin(v * Math.PI * 7), 0, 1));
}

function adsr(ctx, W, H, a, d, s, r) {
  const wa = Math.sqrt(a / 2);
  const wd = Math.sqrt(d / 4);
  const wr = Math.sqrt(r / 8);
  const hold = 0.5;
  const total = wa + wd + hold + wr || 1;
  const x0 = 6;
  const w = Math.max(1, W - 12);
  const top = 16;
  const bot = H - 14;
  const hh = Math.max(1, bot - top);
  const xa = x0 + (wa / total) * w;
  const xd = xa + (wd / total) * w;
  const xs = xd + (hold / total) * w;
  const xr = x0 + w;
  const ys = bot - s * hh;
  ctx.strokeStyle = GREY;
  ctx.beginPath();
  ctx.moveTo(x0, Math.round(bot) + 0.5);
  ctx.lineTo(xr, Math.round(bot) + 0.5);
  ctx.stroke();
  ctx.strokeStyle = ORANGE;
  ctx.beginPath();
  ctx.moveTo(x0, bot);
  const steps = 24;
  for (let i = 1; i <= steps; i++) ctx.lineTo(x0 + ((xa - x0) * i) / steps, bot - hh * (1 - Math.pow(1 - i / steps, 2)));
  for (let i = 1; i <= steps; i++) ctx.lineTo(xa + ((xd - xa) * i) / steps, ys - (ys - top) * Math.exp((-4 * i) / steps) + (ys - top) * Math.exp(-4) * (i / steps));
  ctx.lineTo(xs, ys);
  for (let i = 1; i <= steps; i++) ctx.lineTo(xs + ((xr - xs) * i) / steps, bot - (bot - ys) * (Math.exp((-4 * i) / steps) - Math.exp(-4) * (i / steps)));
  ctx.stroke();
  ctx.fillStyle = WHITE;
  for (const [x, y] of [[xa, top], [xd, ys], [xs, ys]]) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  ctx.fillStyle = GREY;
  ctx.textAlign = "center";
  ctx.fillText("A", (x0 + xa) / 2, H - 4);
  ctx.fillText("D", (xa + xd) / 2, H - 4);
  ctx.fillText("S", (xd + xs) / 2, H - 4);
  ctx.fillText("R", (xs + xr) / 2, H - 4);
}

function secs(t) {
  return t < 1 ? `${Math.round(t * 1000)}MS` : `${t.toFixed(2)}S`;
}

export default {
  wave(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    glass(ctx, W, H);
    const slope = num(p, "Slope", 0.5);
    const shape = num(p, "Shape", 0.5);
    const sm = num(p, "Smoothness", 0.5);
    const shift = num(p, "Shift", 0.3);
    const mode = Math.round(num(p, "Output mode", 0));
    const n = 128;
    const wave = smooth(cycle(n, slope, shape), sm);
    const x0 = 4;
    const w = Math.max(1, W - 8);
    const top = 14;
    const hh = Math.max(1, H - top - 4);
    const trace = (offset, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const ph = (i / w) * 2 + offset;
        const idx = Math.floor((((ph % 1) + 1) % 1) * n) % n;
        const y = top + (1 - (wave[idx] ?? 0)) * hh;
        if (i === 0) ctx.moveTo(x0 + i, y);
        else ctx.lineTo(x0 + i, y);
      }
      ctx.stroke();
    };
    for (let k = 3; k >= 1; k--) trace(-shift * k * 0.25, GREY);
    trace(0, BLUE);
    ctx.fillStyle = WHITE;
    ctx.textAlign = "left";
    ctx.fillText("SLOPE", 6, 10);
    ctx.textAlign = "right";
    ctx.fillStyle = BLUE;
    ctx.fillText(MODES[mode] ?? "AMP", W - 6, 10);
  },
  env(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    glass(ctx, W, H);
    const a = num(p, "Attack", 0.002);
    const d = num(p, "Decay", 0.3);
    const s = clamp(num(p, "Sustain", 0.8), 0, 1);
    const r = num(p, "Release", 0.3);
    adsr(ctx, W, H, a, d, s, r);
    ctx.fillStyle = WHITE;
    ctx.textAlign = "left";
    ctx.fillText("ENV", 6, 10);
    ctx.textAlign = "right";
    ctx.fillStyle = ORANGE;
    ctx.fillText(`${secs(a)} ${secs(d)} ${Math.round(s * 100)}% ${secs(r)}`, W - 6, 10);
  },
};
