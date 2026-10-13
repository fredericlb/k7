// mellotron-v screens: the tape running between two reels, and the macro envelope's shape.
const FONT = "8px ui-monospace, monospace";
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const RED = "#ff3b30";
const WHITE = "#ffffff";
const GREY = "#6b6b6b";

function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function last(arr) {
  return Array.isArray(arr) && arr.length > 0 ? clamp01(arr[arr.length - 1] ?? 0) : 0;
}

function reel(ctx, cx, cy, r, angle, ink) {
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, r * 0.25), 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3);
    ctx.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
    ctx.stroke();
  }
}

export default {
  tape_screen(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    const flutter = clamp01(params["Flutter Amount"] ?? 0.25);
    const sat = clamp01(params["Tape Saturation Amount"] ?? 0);
    const mech = clamp01(params["Mechanics"] ?? 0);
    const noise = clamp01(params["Noise Floor"] ?? 0);
    const level = last(output);
    const t = (now ?? 0) / 1000;
    const r = Math.max(4, Math.min(H * 0.3, W * 0.14));
    const cy = r + 6;
    const lx = W * 0.22;
    const rx = W * 0.78;
    const spin = level > 0.001 ? t * 3 : (state.spin ?? 0);
    state.spin = spin;
    reel(ctx, lx, cy, r, spin, WHITE);
    reel(ctx, rx, cy, r, spin * 0.8, WHITE);
    // The tape path wobbles with flutter and thickens with saturation.
    const y0 = cy + r + Math.max(6, H * 0.12);
    const amp = 1 + flutter * Math.max(2, H * 0.12);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 1 + sat * 3;
    ctx.beginPath();
    const n = 64;
    for (let i = 0; i <= n; i++) {
      const x = lx + ((rx - lx) * i) / n;
      const y = y0 + Math.sin(i * 0.45 + t * 6) * amp * Math.sin((Math.PI * i) / n);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(lx - r, cy);
    ctx.lineTo(lx, y0);
    ctx.moveTo(rx + r, cy);
    ctx.lineTo(rx, y0);
    ctx.stroke();
    // The playback head, lit by the output level.
    const hx = W / 2;
    ctx.fillStyle = level > 0.001 ? GREEN : GREY;
    ctx.fillRect(hx - 5, y0 + amp + 3, 10, 4 + level * 8);
    // Hiss as scattered dots, mechanics as clicks along the frame.
    let seed = Math.floor(t * 10) + 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    ctx.fillStyle = GREY;
    const dots = Math.round(noise * 60);
    for (let i = 0; i < dots; i++) ctx.fillRect(rnd() * W, y0 + rnd() * Math.max(1, H - y0 - 12), 1, 1);
    ctx.fillStyle = BLUE;
    const clicks = Math.round(mech * 8);
    for (let i = 0; i < clicks; i++) ctx.fillRect(4 + (i * (W - 8)) / 8, H - 12, 2, 3);
    ctx.fillStyle = ORANGE;
    ctx.fillText(`FLUT ${Math.round(flutter * 100)}`, 4, H - 3);
    ctx.fillStyle = WHITE;
    ctx.textAlign = "right";
    ctx.fillText(`SAT ${Math.round(sat * 100)}`, W - 4, H - 3);
    ctx.textAlign = "left";
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    const a = clamp01(params["Macro Attack"] ?? 0.5);
    const d = clamp01(params["Macro Decay"] ?? 0.5);
    const s = clamp01(params["Macro Sustain"] ?? 0.5);
    const r = clamp01(params["Macro Release"] ?? 0.5);
    const x0 = 4;
    const top = 12;
    const bottom = H - 12;
    const h = Math.max(1, bottom - top);
    const seg = Math.max(1, (W - 8) / 4.4);
    const xa = x0 + a * seg;
    const xd = xa + d * seg;
    const xs = xd + seg * 0.8;
    const xr = Math.min(W - 4, xs + r * seg);
    const ys = bottom - s * h;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(x0, bottom + 0.5);
    ctx.lineTo(W - 4, bottom + 0.5);
    ctx.stroke();
    ctx.fillStyle = "#3ec96b33";
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    ctx.lineTo(xa, top);
    ctx.lineTo(xd, ys);
    ctx.lineTo(xs, ys);
    ctx.lineTo(xr, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 1;
    ctx.stroke();
    const pts = [[xa, top, BLUE], [xd, ys, GREEN], [xs, ys, ORANGE], [xr, bottom, RED]];
    for (const [px, py, c] of pts) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const level = last(output);
    if (level > 0.001) {
      ctx.fillStyle = GREEN;
      ctx.fillRect(W - 7, bottom - level * h, 3, level * h);
    }
    ctx.fillStyle = BLUE;
    ctx.fillText("A", 4, 9);
    ctx.fillStyle = GREEN;
    ctx.fillText("D", 14, 9);
    ctx.fillStyle = ORANGE;
    ctx.fillText("S", 24, 9);
    ctx.fillStyle = RED;
    ctx.fillText("R", 34, 9);
    ctx.fillStyle = WHITE;
    ctx.textAlign = "right";
    ctx.fillText("ENVELOPE", W - 4, 9);
    ctx.textAlign = "left";
  },
};
