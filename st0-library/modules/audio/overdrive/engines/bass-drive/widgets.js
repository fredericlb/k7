// bass-drive — two pictures side by side: how hard the drive bends the signal, and where the four bands sit.

const DRIVE = "#ff6a1a";
const TONE = "#3ec96b";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The drive's transfer curve: a soft clip that bends harder as Drive rises — its shape, not Bass Drive's exact law. */
function transfer(ctx, x0, y0, w, h, drive) {
  const k = 1 + drive * 9;
  const norm = Math.tanh(k) || 1;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // The straight line a clean signal would follow, for the bend to be read against.
  ctx.moveTo(x0, y0 + h);
  ctx.lineTo(x0 + w, y0);
  ctx.stroke();
  ctx.strokeStyle = DRIVE;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const x = -1 + (2 * i) / 48;
    const y = Math.tanh(k * x) / norm;
    const px = x0 + ((x + 1) / 2) * w;
    const py = y0 + h - ((y + 1) / 2) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** The four bands as a smooth tone shape across low to presence — where each knob pushes, not a measured response. */
function tone(ctx, x0, y0, w, h, bands) {
  const mid = y0 + h / 2;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, Math.round(mid) + 0.5);
  ctx.lineTo(x0 + w, Math.round(mid) + 0.5);
  ctx.stroke();
  const at = (i) => mid - (clamp01(bands[i]) - 0.5) * h * 0.9;
  const xs = bands.map((_, i) => x0 + ((i + 0.5) / bands.length) * w);
  ctx.strokeStyle = TONE;
  ctx.beginPath();
  ctx.moveTo(x0, at(0));
  for (let i = 0; i < bands.length; i++) {
    const prevX = i === 0 ? x0 : xs[i - 1];
    const prevY = i === 0 ? at(0) : at(i - 1);
    const cx = (prevX + xs[i]) / 2;
    ctx.bezierCurveTo(cx, prevY, cx, at(i), xs[i], at(i));
  }
  ctx.lineTo(x0 + w, at(bands.length - 1));
  ctx.stroke();
  ctx.fillStyle = TONE;
  for (let i = 0; i < bands.length; i++) {
    ctx.beginPath();
    ctx.arc(xs[i], at(i), 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default {
  shape(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;

    const pad = 6;
    const top = 13;
    const h = Math.max(1, H - top - pad);
    const left = Math.max(1, Math.min(h * 1.4, W * 0.35));
    const drive = clamp01(params["Drive"] ?? 0.5);
    const bands = ["Low", "Mid", "High", "Presnce"].map((n) => params[n] ?? 0.5);

    transfer(ctx, pad, top, left, h, drive);
    tone(ctx, pad * 3 + left, top, Math.max(1, W - left - pad * 4), h, bands);

    ctx.textAlign = "left";
    ctx.fillStyle = DRIVE;
    ctx.fillText(`DRIVE ${Math.round(drive * 100)}`, pad, 9);
    ctx.fillStyle = TONE;
    ctx.fillText("LOW  MID  HIGH  PRES", pad * 3 + left, 9);
  },
};
