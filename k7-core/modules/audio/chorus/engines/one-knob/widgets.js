// chorus — the tap's delay time over one second: 30 ms swept by a sine whose rate and depth both follow Amount.

const SWEEP = "#3d7dff";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  sweep(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;

    const pad = 6;
    const top = 13;
    const w = Math.max(1, W - pad * 2);
    const h = Math.max(1, H - top - pad);
    const mid = top + h / 2;
    const amp = h / 2 - 1;

    // jsdsp.ts: rate 0.2 to 5 Hz and depth 0 to 20 ms, both linear in Amount; the axis spans 30 ± 20 ms.
    const t = clamp01((params["Amount"] ?? 0) / 100);
    const rate = 0.2 + 4.8 * t;
    const depth = 20 * t;

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, Math.round(mid) + 0.5);
    ctx.lineTo(W - pad, Math.round(mid) + 0.5);
    ctx.stroke();

    // One second of the sweep, scrolling while audio leaves the module.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    const phase = state.out > 0.02 ? (now / 1000) * rate : 0;
    ctx.strokeStyle = SWEEP;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
      const s = i / w;
      const y = mid - Math.sin(2 * Math.PI * (rate * s + phase)) * amp * (depth / 20);
      if (i === 0) ctx.moveTo(pad + i, y);
      else ctx.lineTo(pad + i, y);
    }
    ctx.stroke();

    ctx.fillStyle = SWEEP;
    ctx.textAlign = "left";
    ctx.fillText(`${rate.toFixed(1)} HZ`, pad, 9);
    ctx.fillStyle = GRID;
    ctx.textAlign = "right";
    ctx.fillText(`30 ±${depth.toFixed(1)} MS`, W - pad, 9);
  },
};
