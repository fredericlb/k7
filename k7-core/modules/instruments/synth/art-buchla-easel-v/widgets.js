// Buchla Easel V screens: the complex oscillator's wave, the five sequencer steps, the envelope's shape.
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

// One cycle of the selected waveshape at phase p in [0, 1).
function shapeAt(p, sel) {
  if (sel < 0.25) return 1 - 4 * Math.abs(p - 0.5);
  if (sel < 0.75) return p < 0.5 ? 1 : -1;
  return p < 0.06 ? 1 : -0.15;
}

// The timbre wavefolder: more drive folds the sine back on itself.
function fold(x, t) {
  return Math.sin(x * (1 + t * 4) * Math.PI / 2);
}

const WAVE_NAMES = ["TRI", "SQR", "IMP"];

export default {
  osc_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    if (W < 10 || H < 20) return;
    const timbre = clamp(num(params["Comp Osc Timbre"], 1), 0, 1);
    const mix = clamp(num(params["Comp Osc Wave Mix"], 1), 0, 1);
    const sel = num(params["Comp Osc Waveshape"], 0);
    const index = clamp(num(params["Modulation"], 0.5), 0, 1);
    const modeFM = num(params["Modulation Mode"], 0) < 0.25;
    const modeAM = !modeFM && num(params["Modulation Mode"], 0) < 0.75;
    const mid = (H + 10) / 2, amp = (H - 14) / 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(W, mid + 0.5);
    ctx.stroke();
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    const cycles = 2;
    for (let i = 0; i <= W; i++) {
      const t = (i / W) * cycles;
      const mod = Math.sin(t * Math.PI * 2 * 0.5);
      const ph = modeFM ? t + index * 0.25 * mod : t;
      const p = ((ph % 1) + 1) % 1;
      const sine = fold(Math.sin(p * Math.PI * 2), timbre);
      let v = sine * (1 - mix) + shapeAt(p, sel) * mix;
      if (modeAM) v *= 1 - index * 0.5 * (1 - mod);
      const y = mid - clamp(v, -1, 1) * amp;
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();
    const idx = clamp(Math.round(clamp(sel, 0, 1) * 2), 0, 2);
    tag(ctx, "SINE+" + WAVE_NAMES[idx], 2, 2, WHITE);
    tag(ctx, modeFM ? "FM" : modeAM ? "AM" : "EXT", W - 2, 2, BLUE, "right");
  },

  seq_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    if (W < 20 || H < 20) return;
    const st = num(params["Seq Stages"], 0);
    const stages = st < 0.25 ? 5 : st < 0.75 ? 4 : 3;
    const top = 12, bot = H - 3, h = bot - top;
    const slot = W / 5, bw = Math.max(2, slot - 6);
    for (let i = 0; i < 5; i++) {
      const v = clamp(num(params[`Seq Voltage ${i + 1}`], 0), 0, 1);
      const x = i * slot + 3;
      const on = i < stages;
      ctx.strokeStyle = GREY;
      ctx.strokeRect(x + 0.5, top + 0.5, bw - 1, h - 1);
      ctx.fillStyle = on ? GREEN : GREY;
      const bh = Math.max(1, v * (h - 2));
      ctx.fillRect(x + 1, bot - 1 - bh, bw - 2, bh);
    }
    tag(ctx, stages + " STAGES", 2, 2, WHITE);
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    if (W < 10 || H < 20) return;
    const a = clamp(num(params["Env Attack Rate"], 1), 0, 1);
    const s = clamp(num(params["Env Sustain Rate"], 1), 0, 1);
    const d = clamp(num(params["Env Decay Rate"], 0.5), 0, 1);
    const m = num(params["Env Mode Select"], 0);
    const sustained = m >= 0.75;
    const self = m < 0.25;
    const hold = sustained ? 0.6 : s;
    const total = Math.max(0.2, a + hold + d);
    const top = 12, bot = H - 3;
    const sx = (W - 4) / total;
    ctx.lineWidth = 1;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, bot + 0.5);
    ctx.lineTo(W, bot + 0.5);
    ctx.stroke();
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(2, bot);
    ctx.lineTo(2 + a * sx, top);
    ctx.lineTo(2 + (a + hold) * sx, top);
    ctx.lineTo(2 + (a + hold + d) * sx, bot);
    ctx.stroke();
    if (self) {
      ctx.strokeStyle = GREY;
      ctx.beginPath();
      ctx.moveTo(2 + (a + hold + d) * sx, bot - 3);
      ctx.lineTo(W - 2, bot - 3);
      ctx.stroke();
    }
    tag(ctx, self ? "SELF" : sustained ? "SUSTAINED" : "TRANSIENT", 2, 2, WHITE);
  },
};
