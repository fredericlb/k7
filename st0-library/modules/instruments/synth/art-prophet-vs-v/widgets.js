// prophet-vs-v screens: the vector diamond the joystick mixes four waves in, and the filter and amp envelopes.
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

// A stand-in wave for a wavetable index: morphs sine, triangle, saw and square as the index climbs.
function waveAt(idx, p) {
  const s = Math.sin(p * Math.PI * 2);
  const tri = 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5);
  const saw = 2 * (p % 1) - 1;
  const sq = s >= 0 ? 1 : -1;
  const shapes = [s, tri, saw, sq, s * Math.sin(p * Math.PI * 6)];
  const f = clamp01(idx) * (shapes.length - 1);
  const i = Math.min(shapes.length - 2, Math.floor(f));
  const k = f - i;
  return (shapes[i] ?? 0) * (1 - k) + (shapes[i + 1] ?? 0) * k;
}

function glyph(ctx, cx, cy, w, h, idx, color, weight) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.35 + 0.65 * clamp01(weight);
  ctx.beginPath();
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const x = cx - w / 2 + (w * i) / n;
    const y = cy - waveAt(idx, i / n) * (h / 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function dadsr(ctx, x0, w, top, bottom, a, d, s, r, color, fill) {
  const seg = Math.max(1, w / 4.2);
  const h = Math.max(1, bottom - top);
  const xa = x0 + a * seg;
  const xd = xa + d * seg;
  const xs = xd + seg * 0.8;
  const xr = Math.min(x0 + w, xs + r * seg);
  const ys = bottom - s * h;
  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  ctx.lineTo(xa, top);
  ctx.lineTo(xd, ys);
  ctx.lineTo(xs, ys);
  ctx.lineTo(xr, bottom);
  if (fill) {
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export default {
  vector_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    const jx = clamp01(params["Joystick X"] ?? 0.5);
    const jy = clamp01(params["Joystick Y"] ?? 0.5);
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.max(8, Math.min(W, H) / 2 - 14);
    // Prophet VS layout: A left, B top, C right, D bottom.
    const wA = (1 - jx) / 2;
    const wC = jx / 2;
    const wB = jy / 2;
    const wD = (1 - jy) / 2;
    ctx.strokeStyle = GREY;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.closePath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    const gw = Math.max(10, r * 0.5);
    const gh = Math.max(6, r * 0.25);
    glyph(ctx, cx - r * 0.62, cy - gh, gw, gh, params["Wave Osc A WaveIndex"] ?? 0, BLUE, wA * 2);
    glyph(ctx, cx + r * 0.38, cy - r * 0.62, gw, gh, params["Wave Osc B WaveIndex"] ?? 0, GREEN, wB * 2);
    glyph(ctx, cx + r * 0.62, cy + gh, gw, gh, params["Wave Osc C WaveIndex"] ?? 0, ORANGE, wC * 2);
    glyph(ctx, cx - r * 0.38, cy + r * 0.62, gw, gh, params["Wave Osc D WaveIndex"] ?? 0, RED, wD * 2);
    const px = cx + (jx - 0.5) * r;
    const py = cy - (jy - 0.5) * r;
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = BLUE;
    ctx.fillText("A", 2, cy);
    ctx.textAlign = "right";
    ctx.fillStyle = ORANGE;
    ctx.fillText("C", W - 2, cy);
    ctx.textAlign = "center";
    ctx.fillStyle = GREEN;
    ctx.fillText("B", cx, 6);
    ctx.fillStyle = RED;
    ctx.fillText("D", cx, H - 6);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = GREY;
    ctx.fillText(`${Math.round(wA * 100)}/${Math.round(wB * 100)}`, 2, 9);
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(wC * 100)}/${Math.round(wD * 100)}`, W - 2, H - 3);
    ctx.textAlign = "left";
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    const top = 11;
    const bottom = H - 3;
    const x0 = 4;
    const w = Math.max(1, W - 8);
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(x0, bottom + 0.5);
    ctx.lineTo(x0 + w, bottom + 0.5);
    ctx.stroke();
    const amt = clamp01(params["Filter Envelope Amount"] ?? 0);
    const fTop = bottom - Math.max(0.15, amt) * (bottom - top);
    dadsr(ctx, x0, w, top, bottom,
      clamp01(params["Amp Envelope DADSR Attack"] ?? 0.17),
      clamp01(params["Amp Envelope DADSR Decay"] ?? 0.17),
      clamp01(params["Amp Envelope DADSR Sustain"] ?? 1),
      clamp01(params["Amp Envelope DADSR Release"] ?? 0.17),
      GREEN, "#3ec96b33");
    dadsr(ctx, x0, w, fTop, bottom,
      clamp01(params["Filter Envelope DADSR Attack"] ?? 0.17),
      clamp01(params["Filter Envelope DADSR Decay"] ?? 0.17),
      clamp01(params["Filter Envelope DADSR Sustain"] ?? 1),
      clamp01(params["Filter Envelope DADSR Release"] ?? 0.17),
      ORANGE, null);
    ctx.fillStyle = ORANGE;
    ctx.fillText("FILTER", 4, 8);
    ctx.fillStyle = GREEN;
    ctx.textAlign = "right";
    ctx.fillText("AMP", W - 4, 8);
    ctx.textAlign = "left";
  },
};
