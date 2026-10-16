// bitcrush — a sine as De Rez leaves it: fewer levels as Rez drops, each sample held longer as Rate does.

const CLEAN = "#6b6b6b";
const REZ = "#ff6a1a";
const RATE = "#3d7dff";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  steps(lcd) {
    const { ctx, width: W, height: H, params, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;

    const pad = 6;
    const top = 13;
    const w = Math.max(1, W - pad * 2);
    const h = Math.max(1, H - top - pad);
    const mid = top + h / 2;
    const amp = h / 2 - 1;
    const rez = clamp01(params["Rez"] ?? 1);
    const rate = clamp01(params["Rate"] ?? 1);

    // The clean sine, faint, for the steps to be read against.
    ctx.strokeStyle = CLEAN;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
      const y = mid - Math.sin((i / w) * Math.PI * 4) * amp;
      if (i === 0) ctx.moveTo(pad + i, y);
      else ctx.lineTo(pad + i, y);
    }
    ctx.stroke();

    // Rez 1 is the file's own resolution, 0 about two levels; Rate 1 a sample per pixel, 0 one every twenty-four.
    const bits = 1 + rez * 15;
    const levels = Math.max(2, Math.round(2 ** Math.min(bits, 8)));
    const hold = Math.max(1, Math.round(1 + (1 - rate) * 23));
    ctx.strokeStyle = REZ;
    ctx.beginPath();
    for (let i = 0; i <= w; i += hold) {
      const v = Math.sin((i / w) * Math.PI * 4);
      const q = Math.round(((v + 1) / 2) * (levels - 1)) / (levels - 1) * 2 - 1;
      const y = mid - q * amp;
      if (i === 0) ctx.moveTo(pad, y);
      else ctx.lineTo(pad + i, y);
      ctx.lineTo(pad + Math.min(w, i + hold), y);
    }
    ctx.stroke();

    // The live output as a thin bar along the bottom, so a running module reads as one.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    if (out > 0.01) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(pad, H - 3, w * out, 2);
    }

    ctx.textAlign = "left";
    ctx.fillStyle = REZ;
    ctx.fillText(`${Math.round(bits)} BIT`, pad, 9);
    ctx.fillStyle = RATE;
    ctx.textAlign = "right";
    ctx.fillText(hold > 1 ? `RATE /${hold}` : "RATE FULL", W - pad, 9);
  },
};
