// mu-rings screen — the resonator's partials: grey as struck, green as they still ring once damped.
const FONT = "8px ui-monospace, monospace";
const GREEN = "#3ec96b";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const MODELS = ["MODAL", "SYMP STR", "STRING", "FM VOICE", "SYMP QUANT", "STRING+VERB", "FORMANT", "CHORUS", "REVERB", "FORMANT 2", "ENSEMBLE", "REVERB 2"];
const POLY = ["1", "2", "4"];

function num(p, k, d) {
  const v = p ? p[k] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

export default {
  partials(lcd) {
    const { ctx, width: W, height: H, params: p, output, state } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;
    const structure = num(p, "Structure", 0.5);
    const bright = num(p, "Brightness", 0.5);
    const damp = num(p, "Damping", 0.5);
    const pos = num(p, "Position", 0.5);
    const model = Math.round(num(p, "Model", 0));
    const poly = Math.round(num(p, "Polyphony", 0));
    const harmonic = model === 2 || model === 5;
    const x0 = 6;
    const w = Math.max(1, W - 12);
    const top = 16;
    const bot = H - 6;
    const hh = Math.max(1, bot - top);
    const count = 24;
    const maxRatio = Math.log(40);
    const strike = 0.05 + pos * 0.45;
    let peak = 0;
    if (Array.isArray(output)) for (let i = Math.max(0, output.length - 8); i < output.length; i++) peak = Math.max(peak, output[i] ?? 0);
    state.glow = Math.max(clamp(peak, 0, 1), (state.glow ?? 0) * 0.8);
    for (let k = 1; k <= count; k++) {
      const stretch = harmonic ? structure * 0.004 : (structure - 0.3) * 0.03;
      const ratio = k * Math.sqrt(Math.max(0.05, 1 + stretch * k * k));
      const x = x0 + (Math.log(Math.max(1, ratio)) / maxRatio) * w;
      if (x > x0 + w) continue;
      const comb = Math.abs(Math.sin(Math.PI * k * strike));
      const tilt = Math.pow(k, -(1 - bright) * 1.6);
      const a = clamp(comb * tilt, 0, 1);
      const left = a * Math.exp(-(k - 1) * (0.02 + damp * 0.25));
      const xr = Math.round(x) + 0.5;
      ctx.strokeStyle = GREY;
      ctx.beginPath();
      ctx.moveTo(xr, bot);
      ctx.lineTo(xr, bot - a * hh);
      ctx.stroke();
      ctx.fillStyle = GREEN;
      const h = left * hh;
      ctx.fillRect(xr - 1.5, bot - h, 3, h);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = WHITE;
    ctx.fillText(MODELS[model] ?? "MODAL", 6, 10);
    ctx.textAlign = "right";
    ctx.fillStyle = GREY;
    ctx.fillText(`POLY ${POLY[poly] ?? "1"}`, W - 6, 10);
    const g = state.glow ?? 0;
    if (g > 0.02) {
      ctx.fillStyle = GREEN;
      ctx.globalAlpha = clamp(g, 0, 1);
      ctx.beginPath();
      ctx.arc(W - 52, 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },
};
