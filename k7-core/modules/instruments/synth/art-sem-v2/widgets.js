// SEM V2 screens: the state-variable VCF morphing LP -> notch -> HP, and the two ADS envelopes.
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

// 12 dB state-variable response, crossfading LP (mode 0) to notch (0.5) to HP (1).
function svf(x, fc, q, mode) {
  const r = Math.pow(2, (x - fc) * 10);
  const k = 1 / (0.7 + q * 8);
  const re = 1 - r * r, im = k * r;
  const den = Math.sqrt(re * re + im * im) || 1e-6;
  const wl = clamp(1 - mode * 2, 0, 1), wh = clamp(mode * 2 - 1, 0, 1), wn = 1 - wl - wh;
  return (wl + wh * r * r + wn * Math.abs(re)) / den;
}

function modeName(m) {
  if (m < 0.2) return "LP";
  if (m < 0.4) return "LP/NOTCH";
  if (m < 0.6) return "NOTCH";
  if (m < 0.8) return "NOTCH/HP";
  return "HP";
}

function ads(ctx, a, d, s, x0, sx, top, bot, color, hold) {
  const h = bot - top;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x0, bot);
  ctx.lineTo(x0 + a * sx, top);
  ctx.lineTo(x0 + (a + d) * sx, bot - s * h);
  ctx.lineTo(x0 + (a + d + hold) * sx, bot - s * h);
  ctx.lineTo(x0 + (a + d + hold + d) * sx, bot);
  ctx.stroke();
}

export default {
  vcf_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    if (W < 10 || H < 10) return;
    const fc = clamp(num(params["VCF Freq"], 0.5), 0, 1);
    const q = clamp(num(params["VCF Res"], 0.5), 0, 1);
    const mode = clamp(num(params["VCF Mode"], 0.09), 0, 1);
    const top = 12, bot = H - 3, h = bot - top;
    const zero = top + h * 0.4;
    ctx.lineWidth = 1;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, zero + 0.5);
    ctx.lineTo(W, zero + 0.5);
    ctx.stroke();
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const db = 20 * Math.log10(Math.max(1e-4, svf(i / W, fc, q, mode)));
      const y = clamp(zero - db * (h / 50), top, bot);
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(fc * W, top + 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    tag(ctx, modeName(mode), 2, 2, WHITE);
    tag(ctx, "RES " + Math.round(q * 100), W - 2, 2, ORANGE, "right");
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    if (W < 10 || H < 20) return;
    const e = [1, 2].map((n) => [
      num(params[`ENV${n} Attack`], 0),
      num(params[`ENV${n} Decay`], 0),
      clamp(num(params[`ENV${n} Sustain`], 1), 0, 1),
    ]);
    const hold = 0.4;
    const total = Math.max(0.5, ...e.map(([a, d]) => a + 2 * d + hold));
    const sx = (W - 4) / total;
    const mid = Math.floor(H / 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(W, mid + 0.5);
    ctx.stroke();
    ads(ctx, e[0][0], e[0][1], e[0][2], 2, sx, 12, mid - 3, GREEN, hold);
    ads(ctx, e[1][0], e[1][1], e[1][2], 2, sx, mid + 12, H - 3, BLUE, hold);
    tag(ctx, "ENV 1", 2, 2, GREEN);
    tag(ctx, "ENV 2", 2, mid + 2, BLUE);
  },
};
