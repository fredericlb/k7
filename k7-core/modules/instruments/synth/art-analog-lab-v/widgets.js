// Analog Lab V screens: part 1's filter and envelope, the master delay's echoes and the reverb's tail. Params are normalized 0..1.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));
const p = (params, name, def) => clamp(params[name] ?? def, 0, 1);
const on = (params, name) => (params[name] ?? 1) > 0.5;

function glass(lcd) {
  const { ctx, width: W, height: H } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.lineWidth = 1;
}

function level(arr) {
  if (!arr || !arr.length) return 0;
  let m = 0;
  for (let i = Math.max(0, arr.length - 8); i < arr.length; i++) m = Math.max(m, arr[i] || 0);
  return clamp(m, 0, 1);
}

function tag(ctx, W, text, color) {
  ctx.fillStyle = color;
  ctx.fillText(text, W - 3 - ctx.measureText(text).width, 2);
}

export default {
  vcf_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, output } = lcd;
    const cut = p(params, "P1 VCF Cutoff", 0.7);
    const res = p(params, "P1 VCF Resonance", 0);
    const env = p(params, "P1 VCF Env", 0);
    const lfo = p(params, "P1 VCF LFO", 0);
    ctx.fillStyle = WHITE;
    ctx.fillText("VCF", 3, 2);
    const top = 12, bot = H - 3, h = bot - top, base = top + h * 0.45;
    const fc = 0.05 + cut * 0.9, q = 0.5 + res * 6;
    const curve = (shift, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const r = Math.pow(10, (x / Math.max(1, W) - fc - shift) * 3);
        const g = Math.pow(1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2)), 2);
        const y = clamp(base - (20 * Math.log10(Math.max(1e-6, g)) / 48) * h, top, bot);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    if (env > 0.01) curve(env * 0.3, GREEN);
    curve(0, WHITE);
    if (lfo > 0.01) {
      ctx.fillStyle = BLUE;
      ctx.fillRect((fc - lfo * 0.15) * W, bot - 1, Math.max(1, lfo * 0.3 * W), 2);
    }
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(fc * W, base - res * 0.4 * h, 2.5 + 2 * level(output), 0, Math.PI * 2);
    ctx.fill();
  },

  env_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, output } = lcd;
    const a = p(params, "P1 Attack", 0.1), d = p(params, "P1 Decay", 0.3);
    const s = p(params, "P1 Sustain", 0.6), r = p(params, "P1 Release", 0.3);
    ctx.fillStyle = GREEN;
    ctx.fillText("ENV", 3, 2);
    const top = 12, bot = H - 3, h = bot - top, x0 = 3, w = W - 6, seg = w / 4.2;
    const ax = x0 + seg * (0.05 + a), dx = ax + seg * (0.05 + d), rx = x0 + w - seg * (0.05 + r);
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(x0, bot);
    ctx.lineTo(ax, top);
    ctx.lineTo(dx, bot - s * h);
    ctx.lineTo(Math.max(dx, rx), bot - s * h);
    ctx.lineTo(x0 + w, bot);
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.fillRect(Math.max(dx, rx) - 1, bot - s * h - 1, 3, 3);
    const lv = level(output);
    if (lv > 0.001) {
      ctx.fillStyle = WHITE;
      ctx.fillRect(W - 3, bot - lv * h, 2, lv * h);
    }
  },

  delay_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, output, now } = lcd;
    const active = on(params, "Delay Active");
    const time = p(params, "Delay Time", 0.4), fb = p(params, "Delay Feedback", 0.4);
    const width = p(params, "Delay Stereo Width", 0.7), ret = p(params, "Delay Volume", 0.5);
    ctx.fillStyle = WHITE;
    ctx.fillText("DELAY", 3, 2);
    tag(ctx, W, active ? "ON" : "OFF", active ? GREEN : GREY);
    const mid = (H + 10) / 2, half = (H - 18) / 2;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(3, mid + 0.5);
    ctx.lineTo(W - 3, mid + 0.5);
    ctx.stroke();
    const step = (0.06 + time * 0.3) * (W - 6);
    const col = active ? BLUE : GREY;
    let amp = 0.35 + ret * 0.65;
    ctx.fillStyle = WHITE;
    ctx.fillRect(3, mid - half, 2, half * 2);
    for (let i = 1, x = 3 + step; x < W - 3 && i < 64; i++, x += step) {
      const side = i % 2 ? -1 : 1;
      const hgt = amp * half;
      ctx.fillStyle = col;
      ctx.fillRect(x, side * width > 0 ? mid : mid - hgt, 2, Math.max(1, hgt));
      amp *= 0.15 + fb * 0.8;
      if (amp < 0.02) break;
    }
    const lv = level(output);
    if (active && lv > 0.001) {
      const t = ((now / 1000) * 0.4) % 1;
      ctx.fillStyle = ORANGE;
      ctx.beginPath();
      ctx.arc(3 + t * (W - 6), mid, 2 + 2 * lv, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  reverb_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, output } = lcd;
    const active = on(params, "Reverb Active");
    const decay = p(params, "Reverb Decay", 0.5), size = p(params, "Reverb Size", 0.6);
    const damp = p(params, "Reverb Damping", 0.6), pre = p(params, "Reverb Pre delay", 0.35);
    const ret = p(params, "Reverb Volume", 0.5);
    ctx.fillStyle = WHITE;
    ctx.fillText("REVERB", 3, 2);
    tag(ctx, W, active ? "ON" : "OFF", active ? GREEN : GREY);
    const top = 14, bot = H - 4, h = bot - top;
    const x0 = 3 + pre * 0.15 * (W - 6), len = (W - 6) * (0.25 + decay * 0.75);
    const peak = 0.3 + ret * 0.7, tau = 0.2 + decay * 0.5;
    ctx.fillStyle = WHITE;
    ctx.fillRect(3, top, 2, h);
    const n = Math.round(12 + size * 40);
    for (let i = 0; i < n; i++) {
      const f = i / n;
      const x = x0 + f * len;
      if (x > W - 3) break;
      const jitter = 0.6 + 0.4 * Math.abs(Math.sin(i * 7.31));
      const v = peak * Math.exp(-f / tau) * jitter;
      ctx.fillStyle = active ? (f > 1 - damp * 0.6 ? GREY : BLUE) : GREY;
      ctx.fillRect(x, bot - v * h, 1, Math.max(1, v * h));
    }
    ctx.strokeStyle = active ? WHITE : GREY;
    ctx.beginPath();
    for (let x = 0; x <= len && x0 + x <= W - 3; x++) {
      const y = bot - peak * Math.exp(-(x / Math.max(1, len)) / tau) * h;
      if (x === 0) ctx.moveTo(x0 + x, y);
      else ctx.lineTo(x0 + x, y);
    }
    ctx.stroke();
    const lv = level(output);
    if (lv > 0.001) {
      ctx.fillStyle = RED;
      ctx.fillRect(W - 4, bot - lv * h, 2, lv * h);
    }
  },
};
