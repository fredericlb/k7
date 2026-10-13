// wobble — eight seconds of the delay line's drift: three sines at 0.23, 0.71 and 1.37 Hz, scaled by Amount.

const DRIFT = "#ff6a1a";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const WINDOW_S = 8;
// The largest swing jsdsp.ts allows: 25 · (1 + 0.6 + 0.35) ms.
const MAX_MS = 48.75;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  drift(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;

    const pad = 6;
    const top = 13;
    const w = Math.max(1, W - pad * 2);
    const h = Math.max(1, H - top - pad);
    const mid = top + h / 2;
    const amp = h / 2 - 1;

    const t = clamp01((params["Amount"] ?? 0) / 100);
    const scale = 0.3 + 3 * t;
    const depth = 25 * t;

    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(pad, Math.round(mid) + 0.5);
    ctx.lineTo(W - pad, Math.round(mid) + 0.5);
    ctx.stroke();

    // Scrolls while audio flows through, still otherwise.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    const t0 = state.out > 0.02 ? now / 1000 : 0;
    const TAU = 2 * Math.PI;
    ctx.strokeStyle = DRIFT;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
      const s = t0 + (i / w) * WINDOW_S;
      const ms =
        depth *
        (Math.sin(TAU * scale * 0.23 * s) + 0.6 * Math.sin(TAU * scale * 0.71 * s) + 0.35 * Math.sin(TAU * scale * 1.37 * s));
      const y = mid - (ms / MAX_MS) * amp;
      if (i === 0) ctx.moveTo(pad + i, y);
      else ctx.lineTo(pad + i, y);
    }
    ctx.stroke();

    ctx.fillStyle = DRIFT;
    ctx.textAlign = "left";
    ctx.fillText(`±${(depth * 1.95).toFixed(1)} MS`, pad, 9);
    ctx.fillStyle = GRID;
    ctx.textAlign = "right";
    ctx.fillText(`${WINDOW_S} S`, W - pad, 9);
  },
};
