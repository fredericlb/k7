// Jup-8 V4 screens: the VCF response, the two envelopes, the LFO. Params are the plugin's normalized 0..1 values.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));
const p = (params, name, def) => clamp(params[name] ?? def, 0, 1);

function glass(lcd) {
  const { ctx, width: W, height: H } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.textBaseline = "top";
}

function level(arr) {
  if (!arr || !arr.length) return 0;
  let m = 0;
  for (let i = Math.max(0, arr.length - 8); i < arr.length; i++) m = Math.max(m, arr[i] || 0);
  return clamp(m, 0, 1);
}

function envPoints(a, d, s, r, x0, w) {
  const seg = w / 4.2;
  const ax = x0 + seg * (0.05 + a);
  const dx = ax + seg * (0.05 + d);
  const sx = x0 + w - seg * (0.05 + r) - 1;
  return [[x0, 0], [ax, 1], [dx, s], [Math.max(dx, sx), s], [x0 + w - 1, 0]];
}

export default {
  vcf_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, output } = lcd;
    const cut = p(params, "VCF Cutoff", 1);
    const res = p(params, "VCF Resonance", 0);
    const hp = p(params, "HPF Cutoff", 0);
    const steep = (params["VCF slope"] ?? 1) > 0.5 ? 4 : 2;
    const top = 12, bot = H - 4, h = bot - top;
    ctx.fillStyle = WHITE;
    ctx.fillText(steep === 4 ? "VCF 24DB" : "VCF 12DB", 3, 2);
    ctx.strokeStyle = GREY;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top + h * 0.45 + 0.5);
    ctx.lineTo(W, top + h * 0.45 + 0.5);
    ctx.stroke();
    const fc = 0.04 + cut * 0.94, fh = 0.02 + hp * 0.5, q = 0.5 + res * 6;
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const f = x / Math.max(1, W);
      const ratio = Math.pow(10, (f - fc) * 3);
      const lp = 1 / Math.sqrt(Math.pow(1 - ratio * ratio, 2) + Math.pow(ratio / q, 2));
      const lpN = Math.pow(lp, steep / 2);
      const hr = Math.pow(10, (f - fh) * 3);
      const hpG = hr / Math.sqrt(1 + hr * hr);
      const db = 20 * Math.log10(Math.max(1e-6, lpN * hpG));
      const y = top + h * 0.45 - (db / 48) * h;
      if (x === 0) ctx.moveTo(x, clamp(y, top, bot));
      else ctx.lineTo(x, clamp(y, top, bot));
    }
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(fc * W, top + h * 0.45 - (res * 0.4 * h), 2.5 + 2 * level(output), 0, Math.PI * 2);
    ctx.fill();
    if (hp > 0.01) {
      ctx.fillStyle = GREY;
      ctx.fillRect(0, bot, fh * W, 2);
    }
    ctx.fillStyle = RED;
    ctx.fillRect(W - 4, bot - res * h, 2, res * h);
  },

  env_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, output } = lcd;
    const toVcf = (params["VCF Envelope Selector"] ?? 0) > 0.5 ? 2 : 1;
    const rows = [
      ["ENV 1", BLUE, "Envelope 1", toVcf === 1 ? "> VCF" : ""],
      ["ENV 2", GREEN, "Envelope 2", toVcf === 2 ? "> VCF VCA" : "> VCA"],
    ];
    const half = (H - 2) / 2;
    rows.forEach(([name, col, pre, dest], i) => {
      const y0 = 1 + i * half, top = y0 + 11, bot = y0 + half - 3;
      const pts = envPoints(
        p(params, `${pre} Attack`, 0),
        p(params, `${pre} Decay`, 0.3),
        p(params, `${pre} Sustain`, 0.5),
        p(params, `${pre} Release`, 0.3),
        3,
        W - 6,
      );
      ctx.fillStyle = col;
      ctx.fillText(name, 3, y0 + 1);
      ctx.fillStyle = GREY;
      ctx.fillText(dest, W - 3 - ctx.measureText(dest).width, y0 + 1);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach(([x, v], k) => {
        const y = bot - v * (bot - top);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    const lv = level(output);
    if (lv > 0.001) {
      ctx.fillStyle = WHITE;
      ctx.fillRect(W - 3, H - 2 - lv * (H - 4), 2, lv * (H - 4));
    }
  },

  lfo_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, now, state } = lcd;
    const shape = Math.round(p(params, "LFO Wave Shape", 0) * 3);
    const rate = p(params, "LFO Rate (Unsync)", 0.43);
    const delay = p(params, "LFO Delay", 0);
    const synced = (params["LFO Sync"] ?? 0) > 0.5;
    const names = ["SINE", "SAW", "SQUARE", "NOISE"];
    ctx.fillStyle = WHITE;
    ctx.fillText(`LFO ${names[shape] ?? ""}`, 3, 2);
    ctx.fillStyle = GREY;
    const tag = synced ? "SYNC" : "FREE";
    ctx.fillText(tag, W - 3 - ctx.measureText(tag).width, 2);
    const cycles = 1 + Math.round(rate * 7);
    const top = 14, bot = H - 4, mid = (top + bot) / 2, amp = (bot - top) / 2;
    if (!state.noise) state.noise = Array.from({ length: 64 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
    const wave = (ph) => {
      const t = ph - Math.floor(ph);
      if (shape === 0) return Math.sin(t * Math.PI * 2);
      if (shape === 1) return 1 - 2 * t;
      if (shape === 2) return t < 0.5 ? 1 : -1;
      const n = state.noise[Math.floor(ph) % 64] ?? 0;
      return n * 2 - (n > 0 ? 1 : -1) * 0.5;
    };
    const fadeEnd = delay * 0.6;
    const env = (f) => (fadeEnd > 0 ? clamp(f / fadeEnd, 0, 1) : 1);
    if (fadeEnd > 0) {
      ctx.strokeStyle = GREY;
      ctx.beginPath();
      ctx.moveTo(3, mid - 0.5);
      ctx.lineTo(3 + fadeEnd * (W - 6), top);
      ctx.stroke();
    }
    ctx.strokeStyle = BLUE;
    ctx.beginPath();
    for (let x = 0; x <= W - 6; x++) {
      const f = x / Math.max(1, W - 6);
      const y = mid - wave(f * cycles) * amp * env(f);
      if (x === 0) ctx.moveTo(3 + x, y);
      else ctx.lineTo(3 + x, y);
    }
    ctx.stroke();
    const f = ((now / 1000) * (0.3 + rate * 1.2)) % 1;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(3 + f * (W - 6), mid - wave(f * cycles) * amp * env(f), 2.5, 0, Math.PI * 2);
    ctx.fill();
  },
};
