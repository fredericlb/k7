// The level going in (grey) against the level coming out (orange), from the module's own taps.
const FONT = "8px ui-monospace, monospace";

function trace(ctx, arr, x0, W, H, color) {
  const n = arr.length;
  if (n < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = Math.min(1, Math.max(0, arr[i] ?? 0));
    const x = x0 + (i / (n - 1)) * W;
    const y = H - 4 - v * (H - 14);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function last(arr) {
  return arr && arr.length ? Math.min(1, Math.max(0, arr[arr.length - 1] ?? 0)) : 0;
}

export default {
  level_screen(lcd) {
    const { ctx, width: W, height: H, input, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const inp = Array.isArray(input) ? input : [];
    const out = Array.isArray(output) ? output : [];
    const barW = 10;
    const plotW = Math.max(10, W - 2 * barW - 16);
    ctx.strokeStyle = "#6b6b6b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H - 3.5);
    ctx.lineTo(plotW, H - 3.5);
    ctx.stroke();
    trace(ctx, inp, 0, plotW, H, "#6b6b6b");
    trace(ctx, out, 0, plotW, H, "#ff6a1a");
    const bx = plotW + 8;
    const top = 10;
    const span = Math.max(1, H - 14);
    const vi = last(inp);
    const vo = last(out);
    ctx.fillStyle = "#6b6b6b";
    ctx.fillRect(bx, top + span * (1 - vi), barW - 2, span * vi);
    ctx.fillStyle = "#ff6a1a";
    ctx.fillRect(bx + barW, top + span * (1 - vo), barW - 2, span * vo);
    ctx.font = FONT;
    ctx.fillStyle = "#6b6b6b";
    ctx.fillText("IN", 2, 8);
    ctx.fillStyle = "#ff6a1a";
    ctx.fillText("OUT", 18, 8);
    if (!inp.length && !out.length) {
      ctx.fillStyle = "#6b6b6b";
      ctx.fillText("NO SIGNAL", Math.max(2, plotW / 2 - 20), H / 2);
    }
  },
};
