// quick-master — the three bands across the spectrum with their stereo treatment, and the level against the ceiling.

const FONT = "8px ui-monospace, monospace";
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const RED = "#ff3b30";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const F_LO = 20;
const F_HI = 20000;

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}K` : `${Math.round(f)}`);
const db = (p) => 20 * Math.log10(Math.max(1e-6, p));

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.lineWidth = 1;
}

function text(ctx, s, x, y, color, align) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

const xOf = (b, f) => b.x + (Math.log(clamp(f, F_LO, F_HI) / F_LO) / Math.log(F_HI / F_LO)) * b.w;

// The recent peak of a tap, smoothed in `state` so the picture breathes rather than flickers.
function recent(points, n) {
  let p = 0;
  for (let i = Math.max(0, points.length - n); i < points.length; i++) p = Math.max(p, num(points[i], 0));
  return p;
}

export default {
  // Three bands split at the crossovers, each as tall as its compression amount; the mono bass and the width on top.
  bands(lcd) {
    const { ctx, width: W, height: H, params, output, state } = lcd;
    glass(ctx, W, H);
    const b = { x: 4, y: 24, w: Math.max(1, W - 8), h: Math.max(1, H - 36) };
    const lowX = clamp(num(params["Low Freq"], 180), 40, 500);
    const highX = Math.max(lowX * 1.5, clamp(num(params["High Freq"], 3000), 800, 8000));
    const amounts = [
      [num(params["Low Amount"], 25), F_LO, lowX, ORANGE, "LOW"],
      [num(params["Mid Amount"], 20), lowX, highX, GREEN, "MID"],
      [num(params["High Amount"], 15), highX, F_HI, BLUE, "HIGH"],
    ];
    // The music's level lifts the bars slightly, so a playing master visibly works.
    const target = recent(output, 8);
    state.lvl = num(state.lvl, 0) * 0.7 + target * 0.3;
    const pulse = 0.85 + 0.15 * clamp(state.lvl, 0, 1);

    for (const [amt, f0, f1, color, name] of amounts) {
      const x0 = xOf(b, f0);
      const x1 = xOf(b, f1);
      const h = (clamp(amt, 0, 100) / 100) * b.h * pulse;
      ctx.fillStyle = color;
      ctx.fillRect(x0 + 1, b.y + b.h - h, Math.max(0, x1 - x0 - 2), h);
      text(ctx, name, (x0 + x1) / 2, b.y + b.h + 9, color, "center");
    }
    // Baseline and the two crossovers.
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.h + 0.5);
    ctx.lineTo(b.x + b.w, b.y + b.h + 0.5);
    for (const f of [lowX, highX]) {
      const x = Math.round(xOf(b, f)) + 0.5;
      ctx.moveTo(x, b.y);
      ctx.lineTo(x, b.y + b.h);
    }
    ctx.stroke();
    text(ctx, hz(lowX), xOf(b, lowX) + 2, b.y + 8, WHITE, "left");
    text(ctx, hz(highX), xOf(b, highX) + 2, b.y + 8, WHITE, "left");

    // Bass mono: the low end folded to the centre, a white bracket from 20 Hz to its corner (off below 20).
    const mono = clamp(num(params["Bass Mono"], 120), 0, 300);
    if (mono >= 20) {
      const x = xOf(b, mono);
      ctx.strokeStyle = WHITE;
      ctx.beginPath();
      ctx.moveTo(b.x + 0.5, 14);
      ctx.lineTo(b.x + 0.5, 18.5);
      ctx.lineTo(x + 0.5, 18.5);
      ctx.lineTo(x + 0.5, 14);
      ctx.stroke();
      text(ctx, "MONO", b.x, 10, WHITE, "left");
    }

    // Width: a centred bar, the 100 % mark in grey, red past where mono starts to lose things.
    const width = clamp(num(params["Width"], 110), 0, 200);
    const cx = b.x + b.w * 0.72;
    const half = b.w * 0.12;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx - half) + 0.5, 12);
    ctx.lineTo(Math.round(cx - half) + 0.5, 20);
    ctx.moveTo(Math.round(cx + half) + 0.5, 12);
    ctx.lineTo(Math.round(cx + half) + 0.5, 20);
    ctx.stroke();
    const wHalf = (width / 100) * half;
    ctx.fillStyle = width > 130 ? RED : BLUE;
    ctx.fillRect(cx - wHalf, 14, Math.max(1, wHalf * 2), 4);
    text(ctx, `WIDTH ${Math.round(width)}%`, W - 4, 10, width > 130 ? RED : BLUE, "right");
  },

  // The level going in (pushed by Drive, grey) against what leaves (white), under the ceiling (orange).
  level(lcd) {
    const { ctx, width: W, height: H, params, input, output } = lcd;
    glass(ctx, W, H);
    const b = { x: 4, y: 12, w: Math.max(1, W - 8), h: Math.max(1, H - 16) };
    const LO = -36;
    const drive = clamp(num(params["Drive"], 0), 0, 12);
    const ceiling = clamp(num(params["Ceiling"], -0.3), -12, 0);
    const yOf = (d) => b.y + (1 - (clamp(d, LO, 0) - LO) / -LO) * b.h;

    const trace = (points, shift, color) => {
      const n = Math.min(points.length, Math.floor(b.w));
      if (n < 2) return;
      ctx.strokeStyle = color;
      ctx.beginPath();
      const x0 = b.x + b.w - n;
      for (let i = 0; i < n; i++) {
        const y = yOf(db(num(points[points.length - n + i], 0)) + shift);
        if (i === 0) ctx.moveTo(x0 + i, y);
        else ctx.lineTo(x0 + i, y);
      }
      ctx.stroke();
    };
    trace(input, drive, GREY);
    trace(output, 0, WHITE);

    const yc = Math.round(yOf(ceiling)) + 0.5;
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(b.x, yc);
    ctx.lineTo(b.x + b.w, yc);
    ctx.stroke();
    text(ctx, `CEIL ${ceiling.toFixed(1)}`, b.x, 9, ORANGE, "left");
    text(ctx, `DRIVE +${drive.toFixed(1)}`, W - 4, 9, GREY, "right");
  },
};
