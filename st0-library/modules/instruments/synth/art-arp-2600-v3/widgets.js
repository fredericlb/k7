// ARP 2600 V3 screens: the VCF's response curve and the two envelopes (ADSR + AR).
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
}

function tag(ctx, text, x, y, color, align) {
  ctx.font = FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

// Magnitude of a 2-pole section at normalized log-frequency position.
function response(type, x, fc, q) {
  const r = Math.pow(2, (x - fc) * 10);
  const peak = 1 + q * 6;
  const lp = 1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / peak, 2));
  if (type < 0.125) return Math.abs(1 - r * r) * lp;
  if (type < 0.375) return (r / peak) * lp * peak / Math.max(1, peak * 0.6);
  if (type < 0.625) return r * r * lp;
  if (type < 0.875) return lp;
  return lp * lp / Math.max(1, peak * 0.5);
}

const NAMES = ["NOTCH", "BP 12", "HP 12", "LP 12", "LP 24"];

export default {
  vcf_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    if (W < 10 || H < 10) return;
    const fc = clamp(num(params["Coarse Tune Filter"], 0.5) + (num(params["Fine Tune Filter"], 0.5) - 0.5) * 0.1, 0, 1);
    const q = clamp(num(params["Resonance Filter"], 0.5), 0, 1);
    const type = num(params["Type Filter"], 0.75);
    const top = 12, bot = H - 4, h = bot - top;
    ctx.strokeStyle = GREY;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const zero = top + h * 0.45;
    ctx.moveTo(0, zero + 0.5);
    ctx.lineTo(W, zero + 0.5);
    ctx.stroke();
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const m = response(type, i / W, fc, q);
      const db = 20 * Math.log10(Math.max(1e-4, m));
      const y = clamp(zero - db * (h / 60), top, bot);
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();
    const cx = fc * W;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(cx, top + 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    const idx = clamp(Math.round(clamp(type, 0, 1) * 4), 0, 4);
    tag(ctx, NAMES[idx], 2, 2, WHITE);
    tag(ctx, "RES " + Math.round(q * 100), W - 2, 2, ORANGE, "right");
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    if (W < 10 || H < 10) return;
    const a = num(params["Attack Envelope1"], 0.5);
    const d = num(params["Decay Envelope1"], 0.5);
    const s = clamp(num(params["Sustain Envelope1"], 0.5), 0, 1);
    const r = num(params["Release Envelope1"], 0.5);
    const a2 = num(params["Attack Envelope2"], 0.5);
    const r2 = num(params["Release Envelope2"], 0.5);
    const top = 12, bot = H - 3, h = bot - top;
    const hold = 0.5;
    const total = Math.max(0.001, Math.max(a + d + hold + r, a2 + hold + r2));
    const sx = W / total;
    ctx.lineWidth = 1;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, bot + 0.5);
    ctx.lineTo(W, bot + 0.5);
    ctx.stroke();
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(0, bot);
    ctx.lineTo(a2 * sx, top + 4);
    ctx.lineTo((a2 + hold) * sx, top + 4);
    ctx.lineTo((a2 + hold + r2) * sx, bot);
    ctx.stroke();
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(0, bot);
    ctx.lineTo(a * sx, top);
    ctx.lineTo((a + d) * sx, bot - s * h);
    ctx.lineTo((a + d + hold) * sx, bot - s * h);
    ctx.lineTo((a + d + hold + r) * sx, bot);
    ctx.stroke();
    tag(ctx, "ADSR", 2, 2, GREEN);
    tag(ctx, "AR", W - 2, 2, ORANGE, "right");
  },
};
