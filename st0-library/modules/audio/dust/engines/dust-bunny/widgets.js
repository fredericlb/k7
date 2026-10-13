// dust-bunny — one screen: the level going in against the level coming out, read off the taps, not guessed.

const IN = "#6b6b6b";
const OUT = "#ff6a1a";
const INK = "#ffffff";
const FONT = "8px ui-monospace, monospace";
const FLOOR = -48;

const db = (a) => (a > 1e-5 ? 20 * Math.log10(a) : -100);
const level = (a) => Math.max(0, Math.min(1, (db(a) - FLOOR) / -FLOOR));
const last = (arr) => (Array.isArray(arr) && arr.length > 0 ? Number(arr[arr.length - 1]) || 0 : 0);

/** One tap's recent history as a line, newest at the right edge. */
function trace(ctx, arr, x0, top, w, h, color) {
  const n = Array.isArray(arr) ? Math.min(arr.length, 160) : 0;
  if (n < 2) return;
  const start = arr.length - n;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x0 + (i / (n - 1)) * w;
    const py = top + h * (1 - level(Number(arr[start + i]) || 0));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

export default {
  io(lcd) {
    const { ctx, width: W, height: H, input, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.textBaseline = "alphabetic";

    const pad = 5;
    const top = 13;
    const h = Math.max(1, H - top - pad);
    const barW = 5;
    const bars = barW * 2 + 4;
    const w = Math.max(1, W - pad * 3 - bars);
    const hasIn = Array.isArray(input) && input.length > 0;
    const hasOut = Array.isArray(output) && output.length > 0;

    ctx.strokeStyle = IN;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad + 0.5, top + 0.5, w - 1, h - 1);

    if (!hasIn && !hasOut) {
      ctx.fillStyle = IN;
      ctx.textAlign = "center";
      ctx.fillText("NO SIGNAL", pad + w / 2, top + h / 2 + 3);
    } else {
      trace(ctx, input, pad, top, w, h, IN);
      trace(ctx, output, pad, top, w, h, OUT);
    }

    const inNow = last(input);
    const outNow = last(output);
    const bx = pad * 2 + w;
    ctx.fillStyle = IN;
    const hi = h * level(inNow);
    ctx.fillRect(bx, top + h - hi, barW, hi);
    ctx.fillStyle = OUT;
    const ho = h * level(outNow);
    ctx.fillRect(bx + barW + 4, top + h - ho, barW, ho);

    ctx.textAlign = "left";
    ctx.fillStyle = IN;
    ctx.fillText("IN", pad, 9);
    ctx.fillStyle = OUT;
    ctx.fillText("OUT", pad + 16, 9);
    if (inNow > 1e-4 && outNow > 1e-4) {
      const diff = db(outNow) - db(inNow);
      ctx.textAlign = "right";
      ctx.fillStyle = INK;
      ctx.fillText(`${diff >= 0 ? "+" : ""}${diff.toFixed(1)} DB`, W - pad, 9);
    }
  },
};
