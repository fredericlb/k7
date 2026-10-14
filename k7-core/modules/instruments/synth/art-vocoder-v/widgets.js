// Vocoder V screens: the sixteen bands as a moving spectrum, and the carrier synth's waves and envelope.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = FONT;
  ctx.textBaseline = "top";
}

function peakAt(arr, back) {
  if (!Array.isArray(arr) || !arr.length) return 0;
  const i = Math.max(0, arr.length - 1 - back);
  return Math.min(1, Math.max(0, arr[i] || 0));
}

// One sample of the carrier oscillator at phase p, from its 4-step waveform switch and its shape.
function osc(sel, shape, p) {
  const i = Math.round((sel ?? 0.33) * 3);
  const s = Math.min(0.9, Math.max(0, shape ?? 0));
  if (i === 0) {
    const k = 0.5 + s * 0.45;
    return p < k ? -1 + (2 * p) / k : 1 - (2 * (p - k)) / (1 - k);
  }
  if (i === 1) return 1 - 2 * p;
  if (i === 2) return p < 0.5 - s * 0.45 ? 1 : -1;
  return Math.sin(p * 9301 + 49297 * p * p) * 0.8;
}

export default {
  band_screen(lcd) {
    const { ctx, width: W, height: H, params: P, input, output, state, now } = lcd;
    glass(ctx, W, H);
    const shift = (P["Vocoder Bands Shift"] ?? 0.5) - 0.5;
    const width = P["Vocoder Bands Width"] ?? 0.5;
    const top = 11, bot = H - 2, n = 16;
    const step = W / n;
    const live = Array.isArray(output) && output.length > 0;
    state.lv = state.lv || new Array(n).fill(0);
    ctx.fillStyle = WHITE;
    ctx.fillText("BANDS", 3, 1);
    ctx.fillStyle = GREY;
    ctx.fillText(`SHIFT ${shift >= 0 ? "+" : ""}${Math.round(shift * 24)}`, W - 56, 1);
    for (let b = 0; b < n; b++) {
      const g = P[`Vocoder Band ${b + 1} Gain`] ?? 1;
      const env = live ? peakAt(input?.length ? input : output, b * 3) : 0.35 + 0.25 * Math.sin(now / 900 + b * 0.7);
      state.lv[b] = state.lv[b] * 0.6 + env * 0.4;
      const cx = (b + 0.5 + shift * 4) * step;
      const bw = Math.max(1, step * (0.25 + width * 0.6));
      const hMax = bot - top;
      ctx.strokeStyle = GREY;
      ctx.strokeRect(cx - bw / 2 + 0.5, top + hMax * (1 - g) + 0.5, bw - 1, Math.max(0, hMax * g - 1));
      const h = hMax * g * Math.min(1, state.lv[b]);
      ctx.fillStyle = b < 5 ? BLUE : b < 11 ? WHITE : ORANGE;
      ctx.fillRect(cx - bw / 2, bot - h, bw, h);
    }
  },

  syn_screen(lcd) {
    const { ctx, width: W, height: H, params: P } = lcd;
    glass(ctx, W, H);
    const v1 = P["Synth Osc 1 Volume"] ?? 0.5, v2 = P["Synth Osc 2 Volume"] ?? 0.5;
    const r2 = Math.pow(2, Math.round(((P["Synth Osc 2 Coarse"] ?? 0.5) - 0.5) * 48) / 12) * (1 + ((P["Synth Osc 2 Fine"] ?? 0.5) - 0.5) * 0.06);
    const r1 = Math.pow(2, Math.round(((P["Synth Osc 1 Coarse"] ?? 0.5) - 0.5) * 48) / 12);
    const fm = P["Synth Osc FM 2>1"] ?? 0;
    const waveH = H * 0.55, mid = waveH / 2 + 6, amp = waveH / 2 - 8;
    const draw = (fn, col, alpha) => {
      ctx.strokeStyle = col;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const y = mid - fn(x / W) * amp;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    const o2 = (t) => osc(P["Synth Osc 2 Waveform"], P["Synth Osc 2 Shape"], (t * 2 * r2) % 1);
    const o1 = (t) => {
      const ph = t * 2 * r1 + fm * 0.3 * o2(t);
      return osc(P["Synth Osc 1 Waveform"], P["Synth Osc 1 Shape"], ((ph % 1) + 1) % 1);
    };
    draw(o2, BLUE, 0.5 * Math.max(0.2, v2));
    draw(o1, WHITE, 0.5 * Math.max(0.2, v1));
    const sum = v1 + v2 || 1;
    draw((t) => (o1(t) * v1 + o2(t) * v2) / sum, WHITE, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = WHITE;
    ctx.fillText("CARRIER", 3, 1);
    const a = 0.05 + (P["Synth Attack"] ?? 0.1) * 0.35, r = 0.05 + (P["Synth Release"] ?? 0.1) * 0.35;
    const top = waveH + 10, bot = H - 3, hold = 0.3, total = a + hold + r;
    const sx = (W - 6) / total;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(0, bot + 0.5);
    ctx.lineTo(W, bot + 0.5);
    ctx.stroke();
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(3, bot);
    ctx.lineTo(3 + a * sx, top);
    ctx.lineTo(3 + (a + hold) * sx, top);
    for (let k = 1; k <= 16; k++) ctx.lineTo(3 + (a + hold + (r * k) / 16) * sx, bot - (bot - top) * Math.exp((-4 * k) / 16));
    ctx.stroke();
    ctx.fillStyle = GREEN;
    ctx.fillText("AR", 3, top - 9);
    const glide = P["Synth Glide Time"] ?? 0;
    if (glide > 0.01) {
      ctx.fillStyle = ORANGE;
      ctx.fillText(`GLIDE ${Math.round(glide * 100)}`, W - 52, top - 9);
    }
  },
};
