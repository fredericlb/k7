// sweep — the two resonant 24 dB stages as the knob places them, open at the centre.

const FONT = "8px ui-monospace, monospace";
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const F_LO = 20;
const F_HI = 20000;

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}K` : `${Math.round(f)}`);

// dB of the analog section (b0 s^2 + b1 s + b2) / (a0 s^2 + a1 s + a2) at s = jx.
function sect(b, a, x) {
  const nr = b[2] - b[0] * x * x;
  const ni = b[1] * x;
  const dr = a[2] - a[0] * x * x;
  const di = a[1] * x;
  const n = Math.max(1e-30, nr * nr + ni * ni);
  const d = Math.max(1e-30, dr * dr + di * di);
  return 10 * Math.log10(n / d);
}

const LP = (q) => [[0, 0, 1], [1, 1 / Math.max(0.01, q), 1]];
const HP = (q) => [[1, 0, 0], [1, 1 / Math.max(0.01, q), 1]];
const BP = (q) => [[0, 1 / Math.max(0.01, q), 0], [1, 1 / Math.max(0.01, q), 1]];
const NOTCH = (q) => [[1, 0, 1], [1, 1 / Math.max(0.01, q), 1]];

// dB of one second-order shape at frequency f for a corner fc.
const shape = (s, f, fc) => sect(s[0], s[1], f / Math.max(1e-6, fc));

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.lineWidth = 1;
}

const frame = (W, H) => ({ x: 6, y: 13, w: Math.max(1, W - 12), h: Math.max(1, H - 19) });
const xOf = (b, f) => b.x + (Math.log(clamp(f, F_LO, F_HI) / F_LO) / Math.log(F_HI / F_LO)) * b.w;
const fOf = (b, px) => F_LO * (F_HI / F_LO) ** ((px - b.x) / Math.max(1, b.w));
const yOf = (b, db, lo, hi) => b.y + (1 - (clamp(db, lo, hi) - lo) / Math.max(1e-6, hi - lo)) * b.h;

// The 0 dB line and a tick at 100 Hz, 1 kHz and 10 kHz.
function grid(ctx, b, lo, hi) {
  ctx.strokeStyle = GREY;
  ctx.beginPath();
  const y0 = Math.round(yOf(b, 0, lo, hi)) + 0.5;
  ctx.moveTo(b.x, y0);
  ctx.lineTo(b.x + b.w, y0);
  for (const f of [100, 1000, 10000]) {
    const x = Math.round(xOf(b, f)) + 0.5;
    ctx.moveTo(x, b.y + b.h - 3);
    ctx.lineTo(x, b.y + b.h);
  }
  ctx.stroke();
}

function curve(ctx, b, dbAt, lo, hi, color) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (let px = b.x; px <= b.x + b.w; px++) {
    const y = yOf(b, dbAt(fOf(b, px)), lo, hi);
    if (px === b.x) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();
}

function dot(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function text(ctx, s, x, y, color, align) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

export default {
  response(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    const b = frame(W, H);
    const t = clamp(num(params["Sweep"], 0), -100, 100) / 100;
    const down = clamp(-t, 0, 1);
    const up = clamp(t, 0, 1);
    const lowHz = 30 * (20000 / 30) ** (1 - down);
    const highHz = 20 * (10000 / 20) ** up;
    const lowQ = 0.707 + (6 - 0.707) * down;
    const highQ = 0.707 + (6 - 0.707) * up;
    const trim = 20 * Math.log10(1 - 0.3 * (down + up));
    const at = (f) =>
      shape(LP(0.707), f, lowHz) + shape(LP(lowQ), f, lowHz) + shape(HP(0.707), f, highHz) + shape(HP(highQ), f, highHz) + trim;
    grid(ctx, b, -36, 12);
    const color = down > 0 ? BLUE : up > 0 ? ORANGE : WHITE;
    curve(ctx, b, at, -36, 12, color);
    // Where the moving corner sits, on the curve.
    if (down > 0) dot(ctx, xOf(b, lowHz), yOf(b, at(lowHz), -36, 12), BLUE);
    if (up > 0) dot(ctx, xOf(b, highHz), yOf(b, at(highHz), -36, 12), ORANGE);
    const label = down > 0 ? `LP ${hz(lowHz)}` : up > 0 ? `HP ${hz(highHz)}` : "OPEN";
    text(ctx, "SWEEP", b.x, 9, GREY, "left");
    text(ctx, label, W - 6, 9, color, "right");
  },
};
