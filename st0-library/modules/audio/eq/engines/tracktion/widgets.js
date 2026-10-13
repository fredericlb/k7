// eq3 — the summed curve of the shelves and peaks at their set frequencies and gains.

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

// A shelf's or a peak's gain as the amplitude A of the RBJ cookbook.
const amp = (db) => 10 ** (db / 40);
const lowShelf = (A, q) => [[A, (A * Math.sqrt(A)) / q, A * A], [A, Math.sqrt(A) / q, 1]];
const highShelf = (A, q) => [[A * A, (A * Math.sqrt(A)) / q, A], [1, Math.sqrt(A) / q, A]];
const peak = (A, q) => [[1, A / q, 1], [1, 1 / (A * q), 1]];

export default {
  response(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    const b = frame(W, H);
    const p = (n, d) => num(params[n], d);
    const q = (n) => clamp(p(n, 0.5), 0.1, 4);
    const bands = [
      [lowShelf, p("Low-shelf freq", 200), p("Low-shelf gain", 0), q("Low-shelf Q"), GREEN],
      [peak, p("Mid freq 1", 1000), p("Mid gain 1", 0), q("Mid Q 1"), WHITE],
      [peak, p("Mid freq 2", 5000), p("Mid gain 2", 0), q("Mid Q 2"), GREY],
      [highShelf, p("High-shelf freq", 6000), p("High-shelf gain", 0), q("High-shelf Q"), BLUE],
    ];
    const at = (f) => {
      let db = 0;
      for (const [make, fc, g, bq] of bands) db += shape(make(amp(g), bq), f, Math.max(20, fc));
      return db;
    };
    grid(ctx, b, -24, 24);
    curve(ctx, b, at, -24, 24, WHITE);
    // The second mid is held flat by module.yaml, so its dot shows only once someone moves it.
    for (const [, fc, g, , color] of bands) if (color !== GREY || g !== 0) dot(ctx, xOf(b, fc), yOf(b, at(fc), -24, 24), color);
    text(ctx, "EQ", b.x, 9, GREY, "left");
    const gl = bands[0][2];
    const gm = bands[1][2];
    const gh = bands[3][2];
    const sg = (g) => `${g > 0 ? "+" : ""}${g.toFixed(1)}`;
    text(ctx, sg(gl), W - 70, 9, GREEN, "right");
    text(ctx, sg(gm), W - 38, 9, WHITE, "right");
    text(ctx, sg(gh), W - 6, 9, BLUE, "right");
  },
};
