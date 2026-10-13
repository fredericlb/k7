// hombre — the level going IN against the level coming OUT, so what the texture adds or takes is seen.

const IN = "#3d7dff";
const OUT = "#ff6a1a";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One envelope, mirrored about `mid`, oldest on the left and NOW at the right edge. */
function envelope(ctx, data, len, x0, w, mid, half, color, fill) {
  if (!data.length || len < 2) return;
  const step = w / (len - 1);
  const offset = len - data.length;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = x0 + (offset + i) * step;
    const y = mid - clamp01(data[i] ?? 0) * half;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = data.length - 1; i >= 0; i--)
    ctx.lineTo(x0 + (offset + i) * step, mid + clamp01(data[i] ?? 0) * half);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export default {
  levels(lcd) {
    const { ctx, width: W, height: H, params, input, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;

    const x0 = 6;
    const w = Math.max(1, W - 12);
    const top = 14;
    const bottom = H - 6;
    const mid = (top + bottom) / 2;
    const half = Math.max(1, (bottom - top) / 2);

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(mid) + 0.5);
    ctx.lineTo(x0 + w, Math.round(mid) + 0.5);
    ctx.stroke();

    const inp = Array.isArray(input) ? input : [];
    const out = Array.isArray(output) ? output : [];
    const len = Math.max(inp.length, out.length);
    if (len > 1) {
      // What goes in underneath, filled; what comes out on top, as a line.
      envelope(ctx, inp, len, x0, w, mid, half, IN, true);
      envelope(ctx, out, len, x0, w, mid, half, OUT, false);
    } else {
      // No audio yet: the two settings as bars, so the screen still says where the texture sits.
      const voicing = clamp01(params["Voicing"] ?? 0.5);
      const intensity = clamp01(params["Intensity"] ?? 0.5);
      const barW = Math.max(1, w / 2 - 6);
      ctx.fillStyle = IN;
      ctx.fillRect(x0, bottom - (bottom - top) * voicing, barW, (bottom - top) * voicing);
      ctx.fillStyle = OUT;
      ctx.fillRect(x0 + w / 2 + 6, bottom - (bottom - top) * intensity, barW, (bottom - top) * intensity);
    }

    ctx.fillStyle = IN;
    ctx.textAlign = "left";
    ctx.fillText("IN", x0, 10);
    ctx.fillStyle = OUT;
    ctx.fillText("OUT", x0 + 18, 10);
  },
};
