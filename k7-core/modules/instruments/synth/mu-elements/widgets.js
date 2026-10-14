// mu-elements screens — the three exciters over one note's life, and the partials the resonator rings.
const FONT = "8px ui-monospace, monospace";
const ORANGE = "#ff6a1a";
const BLUE = "#3d7dff";
const RED = "#ff3b30";
const GREEN = "#3ec96b";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const MODELS = ["MODAL", "STRING", "STRINGS", "OMINOUS"];

function num(p, k, d) {
  const v = p ? p[k] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
function noise(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

// The bow and blow envelope: gate held to 0.65; Contour runs from a pluck (0) to a slow swell (1).
function contourEnv(t, c) {
  const att = 0.005 + c * c * 0.4;
  const sus = clamp(c * 1.4, 0, 1);
  const decayed = sus + (1 - sus) * Math.exp(-Math.max(0, t - att) / 0.08);
  const held = t < att ? t / att : decayed;
  return t < 0.65 ? held : held * Math.exp(-(t - 0.65) / (0.03 + c * 0.12));
}

function lane(ctx, x0, w, mid, half, color, name, fn) {
  ctx.strokeStyle = GREY;
  ctx.beginPath();
  ctx.moveTo(x0, Math.round(mid) + 0.5);
  ctx.lineTo(x0 + w, Math.round(mid) + 0.5);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  const n = Math.max(2, Math.floor(w));
  for (let i = 0; i < n; i++) {
    const y = mid - clamp(fn(i / (n - 1), i), -1, 1) * half;
    if (i === 0) ctx.moveTo(x0 + i, y);
    else ctx.lineTo(x0 + i, y);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.fillText(name, 4, mid - half + 8);
}

export default {
  exciter(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;
    const c = num(p, "Contour", 1);
    const bow = num(p, "Bow", 0);
    const bowT = num(p, "Bow timbre", 0.5);
    const blow = num(p, "Blow", 0);
    const blowT = num(p, "Blow timbre", 0.5);
    const flow = num(p, "Flow", 0.5);
    const strike = num(p, "Strike", 0.8);
    const strikeT = num(p, "Strike timbre", 0.5);
    const mallet = num(p, "Mallet", 0.5);
    const x0 = 40;
    const w = Math.max(1, W - x0 - 4);
    const lh = H / 3;
    const half = Math.max(1, lh / 2 - 3);
    const bowF = 6 + bowT * 30;
    lane(ctx, x0, w, lh * 0.5, half, ORANGE, "BOW", (t) => {
      const ph = (t * bowF) % 1;
      return bow * contourEnv(t, c) * (ph * 2 - 1);
    });
    let lp = 0;
    const blowA = 0.08 + blowT * 0.9;
    lane(ctx, x0, w, lh * 1.5, half, BLUE, "BLOW", (t, i) => {
      if (i === 0) lp = 0;
      lp += (noise(i) - lp) * blowA;
      const gust = 1 - flow * 0.5 * (1 + Math.sin(t * 20 + Math.sin(t * 7) * 3)) * 0.5;
      return blow * contourEnv(t, c) * gust * lp * 1.6;
    });
    const width = 0.004 + (1 - mallet) * 0.05;
    const ring = 20 + strikeT * 120;
    lane(ctx, x0, w, lh * 2.5, half, RED, "STRIKE", (t, i) => {
      const e = Math.exp(-t / width);
      const tick = mallet > 0.8 ? (mallet - 0.8) * 4 * Math.exp(-t / 0.2) * (noise(i) > 0.9 ? 1 : 0) : 0;
      return strike * (e * Math.cos(t * ring) + tick);
    });
  },
  resonator(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;
    const geo = num(p, "Geometry", 0.2);
    const bright = num(p, "Brightness", 0.5);
    const damp = num(p, "Damping", 0.25);
    const pos = num(p, "Position", 0.3);
    const space = clamp(num(p, "Space", 0.5), 0, 2);
    const model = Math.round(num(p, "Model", 0));
    const x0 = 6;
    const w = Math.max(1, W - 40);
    const top = 16;
    const bot = H - 6;
    const hh = Math.max(1, bot - top);
    const maxR = Math.log(40);
    const strikeAt = 0.05 + pos * 0.45;
    for (let k = 1; k <= 28; k++) {
      const ratio = Math.pow(k, 0.6 + geo * 0.8);
      const x = x0 + (Math.log(ratio) / maxR) * w;
      if (x > x0 + w) continue;
      const a = clamp(Math.abs(Math.sin(Math.PI * k * strikeAt)) * Math.pow(k, -(1 - bright) * 1.6), 0, 1);
      const left = a * Math.exp(-(k - 1) * (0.02 + damp * 0.25));
      const xr = Math.round(x) + 0.5;
      ctx.strokeStyle = GREY;
      ctx.beginPath();
      ctx.moveTo(xr, bot);
      ctx.lineTo(xr, bot - a * hh);
      ctx.stroke();
      ctx.fillStyle = GREEN;
      ctx.fillRect(xr - 1.5, bot - left * hh, 3, left * hh);
    }
    const cx = W - 18;
    const cy = top + hh / 2;
    const r = 3 + (space / 2) * 11;
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (space > 1) {
      ctx.strokeStyle = GREY;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, r - 4 * (space - 1) - 2), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = GREY;
    ctx.textAlign = "center";
    ctx.fillText("SPACE", cx, bot);
    ctx.textAlign = "left";
    ctx.fillStyle = WHITE;
    ctx.fillText(MODELS[model] ?? "MODAL", 6, 10);
  },
};
