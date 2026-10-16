// bit-glitter — a sine redrawn as the coarse steps Glitter asks for, and the live output over it.

const CLEAN = "#6b6b6b";
const GRIT = "#ff6a1a";
const OUT = "#ffffff";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  grit(lcd) {
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
    const glitter = clamp01(params["Glitter"] ?? 0.5);

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

    // The same sine, held and quantised more coarsely as Glitter rises — its character, not the plugin's exact law.
    const hold = Math.max(1, Math.round(1 + glitter * 18));
    const levels = Math.max(2, Math.round(32 - glitter * 28));
    ctx.strokeStyle = GRIT;
    ctx.beginPath();
    for (let i = 0; i <= w; i += hold) {
      const v = Math.sin((i / w) * Math.PI * 4);
      const q = Math.round(v * (levels / 2)) / (levels / 2);
      const y = mid - q * amp;
      if (i === 0) ctx.moveTo(pad, y);
      else ctx.lineTo(pad + i, y);
      ctx.lineTo(pad + Math.min(w, i + hold), y);
    }
    ctx.stroke();

    // The live output as a thin bar along the bottom, so a running module reads as one.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    if (out > 0.01) {
      ctx.fillStyle = OUT;
      ctx.fillRect(pad, H - 3, w * out, 2);
    }

    ctx.fillStyle = GRIT;
    ctx.textAlign = "left";
    ctx.fillText(`GLITTER ${Math.round(glitter * 100)}`, pad, 9);
  },
};
