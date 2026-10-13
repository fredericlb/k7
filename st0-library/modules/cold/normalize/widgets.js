// normalize screens — the dBFS column: the measured Peak, the Target, and the gain the module applies between them.
const FONT = "8px ui-monospace, monospace";

export default {
  gain_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const target = params["Target"] ?? -1;
    const peak = params["Peak"] ?? 0;
    // Same clamp as jsdsp.ts: the gain never exceeds -60..+30 dB.
    const gain = Math.max(-60, Math.min(30, target - peak));
    const top = 12;
    const bottom = Math.max(top + 1, H - 4);
    const y = (db) => top + (Math.min(0, Math.max(-60, db)) / -60) * (bottom - top);
    const x0 = W * 0.35;
    const x1 = W - 4;
    ctx.strokeStyle = "#6b6b6b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, top);
    ctx.lineTo(x0, bottom);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x0, y(peak) - 1, x1 - x0, 2);
    ctx.fillStyle = "#3d7dff";
    ctx.fillRect(x0, y(target) - 1, x1 - x0, 2);
    const ax = (x0 + x1) / 2;
    ctx.strokeStyle = "#3ec96b";
    ctx.beginPath();
    ctx.moveTo(ax, y(peak));
    ctx.lineTo(ax, y(target));
    ctx.stroke();
    ctx.font = FONT;
    ctx.fillStyle = "#6b6b6b";
    ctx.fillText("PEAK", 2, Math.max(top + 6, y(peak) + 3));
    ctx.fillStyle = "#3d7dff";
    ctx.fillText("TGT", 2, Math.min(bottom, y(target) + 3));
    ctx.fillStyle = "#3ec96b";
    ctx.fillText("GAIN " + (gain >= 0 ? "+" : "") + gain.toFixed(1) + " DB", 2, 9);
  },
};
