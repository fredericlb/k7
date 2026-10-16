// purest-echo — one screen: the dry hit and the four taps, spaced evenly across Time, each as tall as its level.

const TIME = "#ff6a1a";
const TAP = "#3d7dff";
const GRID = "#6b6b6b";
const INK = "#ffffff";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  taps_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;

    const pad = 6;
    const top = 13;
    const h = Math.max(1, H - top - pad - 1);
    const w = Math.max(1, W - pad * 2);
    const base = top + h;
    const time = clamp01(params["Time"] ?? 0.5);
    const span = 0.08 + time * 0.92;

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, base + 0.5);
    ctx.lineTo(pad + w, base + 0.5);
    ctx.stroke();

    // The dry hit at zero, full height, for the taps to be read against.
    ctx.fillStyle = INK;
    ctx.fillRect(pad, top, 2, h);

    ctx.strokeStyle = TIME;
    ctx.beginPath();
    const tx = Math.round(pad + span * (w - 2)) + 0.5;
    ctx.moveTo(tx, base + 3);
    ctx.lineTo(tx, top - 2);
    ctx.stroke();

    ctx.fillStyle = TAP;
    for (let k = 1; k <= 4; k++) {
      const lvl = clamp01(params[`Tap ${k}`] ?? (k === 1 ? 1 : 0));
      const x = pad + (k / 4) * span * (w - 2);
      const bh = Math.max(1, lvl * h);
      ctx.fillRect(Math.round(x) - 1, base - bh, 3, bh);
      ctx.beginPath();
      ctx.arc(Math.round(x) + 0.5, base - bh, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = "left";
    ctx.fillStyle = TIME;
    ctx.fillText(`TIME ${Math.round(time * 100)}`, pad, 9);
    ctx.textAlign = "right";
    ctx.fillStyle = TAP;
    ctx.fillText("TAPS", W - pad, 9);
  },
};
