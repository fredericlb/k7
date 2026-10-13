// phaser — the notches of dry minus a swept tap, |sin(π f τ)|, at the centre and at both ends of the sweep.

const LIVE = "#3d7dff";
const CENTRE = "#ffffff";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const F_LO = 20;
const F_HI = 20000;
const DB_FLOOR = -30;
// jsdsp.ts: the tap sits at 2.2 ms and swings up to 1.9 ms either way.
const CENTRE_MS = 2.2;
const MAX_SWING_MS = 1.9;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function curve(ctx, pad, top, w, h, tauMs) {
  ctx.beginPath();
  for (let i = 0; i <= w; i++) {
    const f = F_LO * (F_HI / F_LO) ** (i / w);
    const mag = Math.abs(Math.sin(Math.PI * f * (tauMs / 1000)));
    const db = Math.max(DB_FLOOR, 20 * Math.log10(Math.max(1e-6, mag)));
    const y = top + (db / DB_FLOOR) * h;
    if (i === 0) ctx.moveTo(pad + i, y);
    else ctx.lineTo(pad + i, y);
  }
  ctx.stroke();
}

export default {
  notches(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;

    const pad = 6;
    const top = 14;
    const w = Math.max(1, W - pad * 2);
    const h = Math.max(1, H - top - pad);

    const t = clamp01((params["Amount"] ?? 0) / 100);
    const rate = 0.1 + 3.9 * t;
    const swing = MAX_SWING_MS * t;

    if (swing > 0.01) {
      ctx.strokeStyle = GRID;
      curve(ctx, pad, top, w, h, CENTRE_MS - swing);
      curve(ctx, pad, top, w, h, CENTRE_MS + swing);
    }

    // The notches where the sweep is now while audio flows; at rest, the centre.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    const moving = state.out > 0.02;
    const tau = moving ? CENTRE_MS + swing * Math.sin(2 * Math.PI * rate * (now / 1000)) : CENTRE_MS;
    ctx.strokeStyle = moving ? LIVE : CENTRE;
    curve(ctx, pad, top, w, h, Math.max(0.05, tau));

    ctx.fillStyle = LIVE;
    ctx.textAlign = "left";
    ctx.fillText(`${rate.toFixed(1)} HZ`, pad, 9);
    ctx.fillStyle = GRID;
    ctx.textAlign = "right";
    ctx.fillText("20 HZ – 20 KHZ", W - pad, 9);
  },
};
