// emulator-ii-v screens: the linked filter's response, and the filter and VCA envelopes overlaid.
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
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
  const mag = 1 / Math.sqrt(re * re + im * im + 1e-9);
  return 20 * Math.log10(mag + 1e-9) * 1.6;
}

function drawCurve(ctx, W, H, c, res, color, dash) {
  const top = 12;
  const yOf = (db) => top + ((18 - clamp(db, -36, 18)) / 54) * (H - top - 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash ? [2, 3] : []);
  ctx.beginPath();
  for (let x = 0; x <= W; x += 2) {
    const y = yOf(lpDb(x / Math.max(W, 1), c, res));
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  return yOf(0);
}

function lastPeak(arr) {
  return Array.isArray(arr) && arr.length > 0 ? clamp(num(arr[arr.length - 1], 0), 0, 1) : 0;
}

// ADSR polyline across the screen width, times in 0..1 mapped to segment widths.
function adsr(ctx, x0, y0, w, h, a, d, s, r, color) {
  const seg = w / 4.2;
  const ax = x0 + Math.pow(a, 0.6) * seg + 1;
  const dx = ax + Math.pow(d, 0.6) * seg + 1;
  const hx = dx + seg * 0.9;
  const rx = hx + Math.pow(r, 0.6) * seg + 1;
  const sy = y0 + h - s * h;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h);
  ctx.lineTo(ax, y0);
  ctx.lineTo(dx, sy);
  ctx.lineTo(hx, sy);
  ctx.lineTo(rx, y0 + h);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(ax - 1.5, y0 - 1.5, 3, 3);
  ctx.fillRect(hx - 1.5, sy - 1.5, 3, 3);
}

export default {
  filter_screen(lcd) {
    const { ctx, width: W, height: H, params, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const c = clamp(num(params["Linked Filter Frequency"], 1), 0, 1);
    const res = clamp(num(params["Linked Filter Resonance"], 0), 0, 1);
    const amt = clamp(num(params["Linked Filter Env. Amount"], 0.5), 0, 1);
    const bright = clamp(num(params["Brightness"], 0), 0, 1);
    const moved = clamp(c + (amt - 0.5) * 0.7, 0, 1);
    if (Math.abs(moved - c) > 0.005) drawCurve(ctx, W, H, moved, res, GREY, true);
    const y0 = drawCurve(ctx, W, H, c, res, WHITE, false);
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y0) + 0.5);
    ctx.lineTo(W, Math.round(y0) + 0.5);
    ctx.stroke();
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.arc(clamp(c * W, 3, W - 3), y0, 3, 0, Math.PI * 2);
    ctx.fill();
    const lvl = lastPeak(output);
    if (lvl > 0.001) {
      ctx.fillStyle = WHITE;
      ctx.fillRect(W - 3, H - lvl * (H - 12), 2, lvl * (H - 12));
    }
    ctx.font = FONT;
    ctx.fillStyle = BLUE;
    ctx.fillText("VCF", 2, 8);
    ctx.fillStyle = ORANGE;
    ctx.fillRect(W - 30, 3, Math.max(1, bright * 24), 4);
    ctx.strokeStyle = GREY;
    ctx.strokeRect(W - 30.5, 2.5, 25, 5);
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const p = (k, d) => clamp(num(params[k], d), 0, 1);
    const pad = 4;
    const top = 14;
    const h = Math.max(4, H - top - pad);
    const w = Math.max(4, W - pad * 2);
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(pad, top + h + 0.5);
    ctx.lineTo(W - pad, top + h + 0.5);
    ctx.stroke();
    adsr(ctx, pad, top, w, h,
      p("Linked Filter Env. Attack", 0), p("Linked Filter Env. Decay", 0),
      p("Linked Filter Env. Sustain", 1), p("Linked Filter Env. Release", 0.15), BLUE);
    adsr(ctx, pad, top, w, h,
      p("Linked VCA Env. Attack", 0), p("Linked VCA Env. Decay", 0),
      p("Linked VCA Env. Sustain", 1), p("Linked VCA Env. Release", 0.15), GREEN);
    const pts = Array.isArray(output) ? output : [];
    if (pts.length > 1) {
      const n = Math.min(pts.length, 256);
      ctx.strokeStyle = WHITE;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = clamp(num(pts[pts.length - n + i], 0), 0, 1);
        const x = pad + (i / (n - 1)) * w;
        const y = top + h - v * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.font = FONT;
    ctx.fillStyle = BLUE;
    ctx.fillText("F.ENV", pad, 9);
    ctx.fillStyle = GREEN;
    ctx.fillText("VCA", pad + 36, 9);
  },
};
