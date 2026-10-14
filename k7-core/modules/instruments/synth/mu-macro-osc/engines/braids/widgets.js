// mu-braids screens — the wave crushed by Bits and Sample rate, and the voice's ADSR.
const FONT = "8px ui-monospace, monospace";
const BLUE = "#3d7dff";
const RED = "#ff3b30";
const ORANGE = "#ff6a1a";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const BITS = [2, 3, 4, 6, 8, 12, 16];
const RATES = [4, 8, 16, 24, 32, 48, 96];
const STEPS = [10, 16, 28, 40, 54, 80, 0];

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

// Timbre sharpens a sine toward a saw, Color folds it; a sketch of the macro, not the shape's exact output.
function macro(ph, timbre, color) {
  const saw = ph * 2 - 1;
  const sine = Math.sin(ph * 2 * Math.PI);
  const v = sine + (saw - sine) * timbre;
  return Math.sin(v * (1 + color * 4) * 1.2) / Math.max(0.2, Math.sin(Math.min(1.5, 1.2 * (1 + color * 4))));
}

export default {
  wave(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    glass(ctx, W, H);
    const timbre = num(p, "Timbre", 0.5);
    const color = num(p, "Color", 0.5);
    const bi = clamp(Math.round(num(p, "Bits", 6)), 0, 6);
    const ri = clamp(Math.round(num(p, "Sample rate", 5)), 0, 6);
    const levels = Math.pow(2, BITS[bi] ?? 16) / 2;
    const x0 = 4;
    const w = Math.max(1, W - 8);
    const top = 16;
    const mid = top + (H - top - 4) / 2;
    const half = Math.max(1, (H - top - 4) / 2);
    const cycles = 2;
    const steps = STEPS[ri] ?? 0;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(mid) + 0.5);
    ctx.lineTo(x0 + w, Math.round(mid) + 0.5);
    ctx.stroke();
    const sample = (u) => {
      const held = steps > 0 ? Math.floor(u * steps * cycles) / (steps * cycles) : u;
      const v = clamp(macro((held * cycles) % 1, timbre, color), -1, 1);
      return Math.round(v * levels) / levels;
    };
    ctx.strokeStyle = BLUE;
    ctx.beginPath();
    let last = 0;
    for (let i = 0; i <= w; i++) {
      const y = mid - clamp(sample(i / w), -1, 1) * half;
      if (i === 0) ctx.moveTo(x0, y);
      else {
        ctx.lineTo(x0 + i, last);
        ctx.lineTo(x0 + i, y);
      }
      last = y;
    }
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = WHITE;
    ctx.fillText("OSC", 6, 10);
    ctx.textAlign = "right";
    ctx.fillStyle = RED;
    ctx.fillText(`${BITS[bi] ?? 16}BIT ${RATES[ri] ?? 48}K`, W - 6, 10);
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
