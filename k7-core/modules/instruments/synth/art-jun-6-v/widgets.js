// Screens for Jun-6 V: the filter's response and the envelope's shape.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = FONT;
  ctx.textBaseline = "top";
}

// A 4-pole low-pass in dB at frequency ratio r = f / fc, with its resonant bump.
function lowpassDb(r, q) {
  const re = 1 - r * r, im = r / q;
  const mag2 = re * re + im * im;
  return -10 * Math.log10(Math.max(1e-9, mag2)) * 2;
}

function curve(ctx, W, top, bottom, dbAt, color) {
  const mid = top + (bottom - top) * 0.35, span = (bottom - top) * 0.65;
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (let x = 2; x <= W - 2; x++) {
    const db = clamp(dbAt((x - 2) / Math.max(1, W - 4)), -48, 18);
    const y = db >= 0 ? mid - (db / 18) * (mid - top) : mid - (db / 48) * span;
    if (x === 2) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export default {
  filter(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    const cut = clamp(num(params["VCF Cutoff"], 1), 0, 1);
    const res = clamp(num(params["VCF Resonance"], 0), 0, 1);
    const hpf = clamp(num(params["HPF Cutoff"], 0), 0, 1);
    const envAmt = clamp(num(params["VCF Envelope Modulation"], 0), 0, 1);
    const neg = num(params["VCF Envelope Polarity"], 0) >= 0.5;
    const q = 0.5 + res * res * 12;
    const fOf = (t) => 20 * Math.pow(1000, t);
    const fc = fOf(cut), fh = hpf > 0.01 ? 20 * Math.pow(50, hpf) : 0;
    const dbAt = (fcut) => (t) => {
      const f = fOf(t);
      let db = lowpassDb(f / fcut, q);
      if (fh) db += -10 * Math.log10(1 + Math.pow(fh / f, 4));
      return db;
    };
    const top = 12, bottom = H - 2;
    // Where the envelope sweeps the cutoff to, as a grey ghost.
    if (envAmt > 0.01) curve(ctx, W, top, bottom, dbAt(fOf(clamp(cut + (neg ? -1 : 1) * envAmt * 0.6, 0, 1))), GREY);
    curve(ctx, W, top, bottom, dbAt(fc), WHITE);
    const x = 2 + cut * (W - 4);
    ctx.fillStyle = res > 0.05 ? RED : ORANGE;
    ctx.beginPath();
    ctx.arc(x, top + (bottom - top) * 0.35 - res * 8, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (fh) {
      ctx.fillStyle = BLUE;
      ctx.fillRect(2 + hpf * (W - 4) * (Math.log(50) / Math.log(1000)), bottom - 4, 3, 3);
    }
    ctx.fillStyle = ORANGE;
    ctx.fillText("VCF", 3, 2);
    if (fh) {
      ctx.fillStyle = BLUE;
      ctx.fillText("HPF", 24, 2);
    }
  },

  envelope(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    const a = clamp(num(params["Envelope 1 Attack"], 0), 0, 1);
    const d = clamp(num(params["Envelope 1 Decay"], 0), 0, 1);
    const s = clamp(num(params["Envelope 1 Sustain"], 1), 0, 1);
    const r = clamp(num(params["Envelope 1 Release"], 0.01), 0, 1);
    const top = 12, bottom = H - 3, h = bottom - top, w = W - 8;
    // Each stage takes up to a quarter of the width; the held sustain fills one fixed slice.
    const ax = 4 + a * w * 0.25, dx = ax + 2 + d * w * 0.25, sx = dx + w * 0.18, rx = sx + 2 + r * w * 0.3;
    const sy = bottom - s * h;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(4, bottom);
    ctx.lineTo(W - 4, bottom);
    ctx.stroke();
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(4, bottom);
    ctx.lineTo(ax, top);
    ctx.quadraticCurveTo(ax + (dx - ax) * 0.3, sy, dx, sy);
    ctx.lineTo(sx, sy);
    ctx.quadraticCurveTo(sx + (rx - sx) * 0.3, bottom, rx, bottom);
    ctx.stroke();
    ctx.fillStyle = WHITE;
    for (const [x, y] of [[ax, top], [dx, sy], [sx, sy]]) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.fillStyle = GREEN;
    ctx.fillText("ENV", 3, 2);
  },
};
