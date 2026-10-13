// vox-continental-v2 screen: the wave the two manuals' footage drawbars add up to, and each drawbar's partial.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
// Each drawbar's pitch as a multiple of the 8' fundamental: 16', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1'.
const RATIO = [0.5, 1, 2, 3, 4, 5, 6, 8];

function text(ctx, s, x, y, c, align) {
  ctx.fillStyle = c;
  ctx.font = FONT;
  ctx.textAlign = align || "left";
  ctx.fillText(s, x, y);
}

function levels(p, manual) {
  const out = [];
  for (let i = 1; i <= 8; i++) out.push(Math.max(0, Math.min(1, p[`${manual} Ft ${i}`] ?? 1)));
  return out;
}

// A flute is a sine, a reed a square: the voice blend shapes every partial alike.
function sample(lv, ph, flute, reed) {
  let s = 0;
  for (let i = 0; i < 8; i++) {
    if (lv[i] <= 0) continue;
    const a = 2 * Math.PI * ph * RATIO[i];
    s += lv[i] * (flute * Math.sin(a) + reed * (Math.sin(a) >= 0 ? 0.7 : -0.7));
  }
  return s;
}

function plot(ctx, lv, flute, reed, x, y, w, h, col) {
  let max = 1e-6;
  const n = Math.max(2, Math.floor(w));
  const ys = [];
  for (let i = 0; i <= n; i++) {
    const v = sample(lv, (i / n) * 2, flute, reed);
    ys.push(v);
    max = Math.max(max, Math.abs(v));
  }
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const px = x + (i / n) * w, py = y + h / 2 - (ys[i] / max) * (h / 2);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

export default {
  organ_screen(lcd) {
    const { ctx, width: W, height: H, params: p, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const up = levels(p, "Upper"), lo = levels(p, "Lower");
    const uf = p["Upper Flute"] ?? 1, ur = p["Upper Reed"] ?? 1;
    const lf = p["Lower Flute"] ?? 1, lr = p["Lower Reed"] ?? 1;
    const swell = p["Swell Pedal"] ?? 1;
    const vib = (p["Vibrato On/Off"] ?? 0) >= 0.5;
    const split = W * 0.55;
    const wy = 14, wh = H - 24;
    const wob = vib ? Math.sin(((now || 0) / 1000) * (2 + (p["Vibrato Rate"] ?? 0.7) * 6)) * (p["Vibrato Depth"] ?? 0.5) * 2 : 0;
    plot(ctx, lo, lf, lr, 4, wy + wh * 0.5, split - 8, wh * 0.45 * swell, GREEN);
    plot(ctx, up, uf, ur, 4 + wob, wy, split - 8, wh * 0.5 * swell, BLUE);
    text(ctx, "UPPER", 4, 9, BLUE);
    text(ctx, "LOWER", 40, 9, GREEN);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(split, 4, 1, H - 8);
    const bx = split + 6, bw = W - bx - 4, base = H - 12, top = 14;
    const slot = bw / 8;
    for (let i = 0; i < 8; i++) {
      const x = bx + i * slot;
      const hu = (base - top) * up[i], hl = (base - top) * lo[i];
      ctx.fillStyle = up[i] > 0.01 ? BLUE : GREY;
      ctx.fillRect(x, base - Math.max(1, hu), Math.max(2, slot * 0.4), Math.max(1, hu));
      ctx.fillStyle = lo[i] > 0.01 ? GREEN : GREY;
      ctx.fillRect(x + slot * 0.45, base - Math.max(1, hl), Math.max(2, slot * 0.4), Math.max(1, hl));
      const perc = i < 4 && (p[`Perc Ft ${i + 1}`] ?? 0) >= 0.5;
      if (perc) { ctx.fillStyle = ORANGE; ctx.fillRect(x, top - 4, Math.max(2, slot * 0.85), 2); }
    }
    text(ctx, (p["Engine"] ?? 0) >= 0.5 ? "JENNINGS" : "VOX", W - 4, 9, WHITE, "right");
    text(ctx, "16'", bx, H - 2, GREY);
    text(ctx, "1'", W - 4, H - 2, GREY, "right");
  },
};
