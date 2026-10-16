// The echoes: the dry hit, then repeats spaced by Delay and shrinking by Feedbak (time is relative, not ms).
const FONT = "8px ui-monospace, monospace";

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

export default {
  taps_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const time = clamp(params["Delay"] ?? 0.5, 0, 1);
    const fb = clamp(params["Feedbak"] ?? 0.5, 0, 0.98);
    const base = H - 4;
    const top = 12;
    const span = Math.max(1, base - top);
    const x0 = 6;
    const step = Math.max(4, (0.08 + 0.42 * time) * Math.max(1, W - x0 - 4));
    ctx.strokeStyle = "#6b6b6b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, base + 0.5);
    ctx.lineTo(W, base + 0.5);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x0, top, 2, span);
    let amp = 1;
    for (let i = 1; i < 64; i++) {
      amp *= fb;
      const x = x0 + i * step;
      if (x > W - 2 || amp < 0.02) break;
      const h = span * amp;
      ctx.fillStyle = "#3d7dff";
      ctx.fillRect(x, base - h, 2, h);
    }
    ctx.font = FONT;
    ctx.fillStyle = "#3d7dff";
    ctx.fillText("TIME " + Math.round(time * 100), 2, 8);
    ctx.fillText("FDBK " + Math.round(fb * 100), Math.max(2, W - 48), 8);
  },
};
