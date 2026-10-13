// delay — the repeats one hit leaves: each tap Feedback dB under the last, until they fall below -60 dB.
// The delay TIME is the plugin's own setting and no param, so the taps are evenly spaced.

const FB = "#3d7dff";
const DRY = "#ffffff";
const GRID = "#6b6b6b";
const FLOOR = -60;
const MAX_TAPS = 24;

export default {
  taps(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const fb = Math.min(0, Math.max(-30, params["Feedback"] ?? -6));
    // Repeats until -60 dB; at 0 dB it never dies, which the screen caps and says.
    const endless = fb > -0.05;
    const count = endless ? MAX_TAPS : Math.min(MAX_TAPS, Math.ceil(FLOOR / fb));

    const pad = 6;
    const top = 14;
    const base = H - pad;
    const span = Math.max(1, base - top);
    const step = (W - pad * 2 - 40) / (MAX_TAPS + 1);

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, Math.round(base) + 0.5);
    ctx.lineTo(W - pad - 40, Math.round(base) + 0.5);
    ctx.stroke();

    // A tap's height is its level in dB mapped onto 0..-60, so a long tail reads as a slope.
    const heightOf = (db) => ((Math.max(FLOOR, db) - FLOOR) / -FLOOR) * span;
    // While audio leaves the module, a dot walks the repeats so the tail is seen moving.
    const out = Array.isArray(output) && output.length ? (output[output.length - 1] ?? 0) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    const lit = state.out > 0.02 ? Math.floor(now / 180) % (count + 1) : -1;

    for (let k = 0; k <= count; k++) {
      const x = Math.round(pad + step * k) + 0.5;
      const h = heightOf(fb * k);
      ctx.fillStyle = k === 0 ? DRY : FB;
      ctx.globalAlpha = k === lit ? 1 : k === 0 ? 0.9 : 0.75;
      ctx.fillRect(x - 1, base - h, 3, h);
    }
    ctx.globalAlpha = 1;

    // The one number that matters: how many repeats are heard.
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillStyle = FB;
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("REPEATS", W - pad, 4);
    ctx.font = "16px ui-monospace, monospace";
    ctx.fillText(endless ? "INF" : String(count), W - pad, 16);
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillStyle = GRID;
    ctx.fillText(`${fb.toFixed(1)} DB`, W - pad, 38);
    ctx.textAlign = "left";
    ctx.fillStyle = DRY;
    ctx.fillText("HIT", pad, 4);
  },
};
