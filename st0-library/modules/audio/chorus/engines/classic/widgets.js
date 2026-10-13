// chorus-classic — the delay sweep over one second: Depth milliseconds either side, Speed cycles a second.

const SWEEP = "#3d7dff";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const MAX_DEPTH = 20;

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

    const speed = Math.max(0, params["Speed"] ?? 1);
    const depth = Math.max(0, Math.min(MAX_DEPTH, params["Depth"] ?? 3));

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, Math.round(mid) + 0.5);
    ctx.lineTo(W - pad, Math.round(mid) + 0.5);
    ctx.stroke();

    // The sweep scrolls while audio leaves the module, and stands still otherwise.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    const phase = state.out > 0.02 ? (now / 1000) * speed : 0;
    ctx.strokeStyle = SWEEP;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
      const y = mid - Math.sin(2 * Math.PI * (speed * (i / w) + phase)) * amp * (depth / MAX_DEPTH);
      if (i === 0) ctx.moveTo(pad + i, y);
      else ctx.lineTo(pad + i, y);
    }
    ctx.stroke();

    ctx.fillStyle = SWEEP;
    ctx.textAlign = "left";
    ctx.fillText(`${speed.toFixed(1)} HZ`, pad, 9);
    ctx.fillStyle = GRID;
    ctx.textAlign = "right";
    ctx.fillText(`±${depth.toFixed(1)} MS  1 S`, W - pad, 9);
  },
};
