// tremolo — the gain over one second: (1 - Depth) + Depth · (sin + 1) / 2, a sine at Rate.

const GAIN = "#3d7dff";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  gain(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;

    const pad = 6;
    const top = 13;
    const w = Math.max(1, W - pad * 2);
    const h = Math.max(1, H - top - pad);
    const rate = Math.max(0, params["Rate"] ?? 5);
    const depth = clamp01(params["Depth"] ?? 0.5);

    // Unity at the top, silence at the bottom.
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(pad, top + 0.5);
    ctx.lineTo(W - pad, top + 0.5);
    ctx.moveTo(pad, top + h - 0.5);
    ctx.lineTo(W - pad, top + h - 0.5);
    ctx.stroke();

    // Scrolls while audio flows through, still otherwise.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    const phase = state.out > 0.02 ? (now / 1000) * rate : 0;
    ctx.fillStyle = GAIN;
    for (let i = 0; i <= w; i += 2) {
      const lfo = (Math.sin(2 * Math.PI * (rate * (i / w) + phase)) + 1) / 2;
      const g = 1 - depth + depth * lfo;
      const bar = Math.max(1, g * h);
      ctx.fillRect(pad + i, top + h - bar, 1, bar);
    }

    ctx.fillStyle = GAIN;
    ctx.textAlign = "left";
    ctx.fillText(`${rate.toFixed(1)} HZ`, pad, 9);
    ctx.fillStyle = GRID;
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(depth * 100)}%`, W - pad, 9);
  },
};
