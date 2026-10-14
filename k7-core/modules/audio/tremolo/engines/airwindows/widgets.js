// tremolo — one screen: the gain the tremolo rides, its depth exact, its speed drawn as a relative cycle count.

const DEPTH = "#3d7dff";
const GRID = "#6b6b6b";
const INK = "#ffffff";
const FONT = "8px ui-monospace, monospace";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  wave(lcd) {
    const { ctx, width: W, height: H, params, output, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;

    const pad = 5;
    const top = 13;
    const h = Math.max(1, H - top - pad);
    const w = Math.max(1, W - pad * 2);
    const speed = clamp01(params["Speed"] ?? 0.5);
    const depth = clamp01(params["Depth"] ?? 0.5);
    const cycles = 1 + speed * 5;
    const moving = Array.isArray(output) && output.length > 0 && (output[output.length - 1] ?? 0) > 1e-4;
    const phase = moving ? ((Number(now) || 0) / 1000) * cycles * 0.5 : 0;
    const gain = (u) => 1 - depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * (u * cycles - phase)));

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, top + 0.5);
    ctx.lineTo(pad + w, top + 0.5);
    ctx.stroke();

    // The signal itself, a steady carrier whose height the tremolo rides.
    ctx.fillStyle = GRID;
    for (let x = 0; x < w; x += 3) ctx.fillRect(pad + x, top + h * (1 - gain(x / w)), 1, h * gain(x / w));

    ctx.strokeStyle = DEPTH;
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const u = i / 96;
      const px = pad + u * w;
      const py = top + h * (1 - gain(u));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = DEPTH;
    ctx.fillText(`DEPTH ${Math.round(depth * 100)}`, pad, 9);
    ctx.textAlign = "right";
    ctx.fillStyle = INK;
    ctx.fillText(`SPEED ${Math.round(speed * 100)}`, W - pad, 9);
  },
};
