// echo — the repeats the delay makes: where each one lands in time, and how loud it plays.

const DRY = "#ffffff";
const WET = "#3d7dff";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
// The window drawn, in ms: two seconds holds a dub delay's tail at any Time the knob allows.
const WINDOW_MS = 2000;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  repeats(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;

    const pad = 8;
    const base = H - 12;
    const top = 14;
    const span = Math.max(1, W - pad * 2);
    const tall = Math.max(1, base - top);

    const time = Math.max(1, params["Time"] ?? 250);
    const feedback = clamp01(params["Feedback"] ?? 0.6);
    // The engine's blend around the delay: the dry hit shrinks as the repeats grow.
    const mix = clamp01(params["@mix"] ?? 1);
    const wet = Math.sin((mix * Math.PI) / 2);
    const dry = Math.cos((mix * Math.PI) / 2);

    // The time axis, a tick every 250 ms.
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, base + 0.5);
    ctx.lineTo(W - pad, base + 0.5);
    for (let ms = 250; ms < WINDOW_MS; ms += 250) {
      const x = Math.round(pad + (span * ms) / WINDOW_MS) + 0.5;
      ctx.moveTo(x, base);
      ctx.lineTo(x, base + 3);
    }
    ctx.stroke();

    const bar = (ms, level, color) => {
      const x = Math.round(pad + (span * ms) / WINDOW_MS);
      const h = Math.max(1, tall * clamp01(level));
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, base - h, 3, h);
    };

    // The dry hit at zero, then each repeat one Time later, a Feedback quieter than the last.
    bar(0, dry, DRY);
    let level = wet;
    for (let n = 1; n <= 64; n++) {
      const ms = n * time;
      if (ms >= WINDOW_MS || level < 0.01) break;
      bar(ms, level, WET);
      level *= feedback;
    }

    // A dot riding the repeats while audio leaves the module, so a running delay reads as one.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    if (state.out > 0.02) {
      const phase = (now % WINDOW_MS) / WINDOW_MS;
      ctx.fillStyle = WET;
      ctx.beginPath();
      ctx.arc(pad + span * phase, top - 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // The one value that matters, big; the rest small.
    ctx.fillStyle = DRY;
    ctx.textAlign = "right";
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.fillText(`${Math.round(time)} MS`, W - pad, 11);
    ctx.font = FONT;
    ctx.fillStyle = GRID;
    ctx.textAlign = "left";
    ctx.fillText(`FB ${Math.round(feedback * 100)}%`, pad, 10);
  },
};
