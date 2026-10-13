// overdrive — one screen: the exact transfer curve jsdsp.ts runs, tanh(drive·x) with its makeup gain.

const DRIVE = "#ff6a1a";
const GRID = "#6b6b6b";
const INK = "#ffffff";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The curve for Amount 0..100, the same law and makeup ramp as jsdsp.ts. */
function shaper(amount) {
  const drive = 1 + 49 * clamp01(amount / 100);
  const makeup = 1.313 + (1 - 1.313) * clamp01((drive - 1) / 3);
  return { drive, fn: (x) => Math.tanh(drive * x) * makeup };
}

export default {
  curve(lcd) {
    const { ctx, width: W, height: H, params, input } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;

    const pad = 5;
    const top = 13;
    const h = Math.max(1, H - top - pad);
    const w = Math.max(1, Math.min(W - pad * 2, h * 2.2));
    const x0 = (W - w) / 2;
    const { drive, fn } = shaper(Number(params["Amount"] ?? 0));
    const px = (x) => x0 + ((x + 1) / 2) * w;
    const py = (y) => top + h - ((Math.max(-1.2, Math.min(1.2, y)) + 1) / 2) * h;

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px(-1), py(-1));
    ctx.lineTo(px(1), py(1));
    ctx.moveTo(x0, Math.round(py(0)) + 0.5);
    ctx.lineTo(x0 + w, Math.round(py(0)) + 0.5);
    ctx.stroke();

    ctx.strokeStyle = DRIVE;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const x = -1 + (2 * i) / 64;
      if (i === 0) ctx.moveTo(px(x), py(fn(x)));
      else ctx.lineTo(px(x), py(fn(x)));
    }
    ctx.stroke();

    // Where the loudest recent input sits on the curve, when there is any.
    const n = Array.isArray(input) ? input.length : 0;
    if (n > 0) {
      const a = Math.max(0, Math.min(1, Number(input[n - 1]) || 0));
      if (a > 1e-4) {
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(px(a), py(fn(a)), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.textAlign = "left";
    ctx.fillStyle = DRIVE;
    ctx.fillText(`DRIVE x${drive.toFixed(drive < 10 ? 1 : 0)}`, pad, 9);
  },
};
