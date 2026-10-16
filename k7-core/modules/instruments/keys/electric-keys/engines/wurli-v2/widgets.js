// Screens for Wurli V2: the struck reed, the graphic EQ's curve, the Leslie's rotors.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const last = (arr) => (Array.isArray(arr) && arr.length ? num(arr[arr.length - 1], 0) : 0);

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = FONT;
  ctx.textBaseline = "top";
}

function tag(ctx, text, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export default {
  reed(lcd) {
    const { ctx, width: W, height: H, params, output, state } = lcd;
    glass(ctx, W, H);
    const hard = clamp(num(params["Hammer Hardness"], 0.5), 0, 1);
    const damp = clamp(num(params["Damping Duration"], 0.4), 0, 1);
    const dist = clamp(num(params["Pickup Distance"], 0.5), 0, 1);
    const axis = clamp(num(params["Pickup Axis"], 0.5), 0, 1);
    const trem = clamp(num(params["Tremolo"], 0), 0, 1);
    // The reed on the left third: clamped at its root, the tip swinging with the output level.
    const rw = Math.max(20, W * 0.3), cy = H * 0.55;
    const lvl = clamp(last(output) * 3, 0, 1);
    state.swing = num(state.swing, 0) * 0.6 + lvl * 0.4;
    const tipY = cy - state.swing * H * 0.25;
    ctx.fillStyle = GREY;
    ctx.fillRect(4, cy - 6, 5, 12);
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(9, cy);
    ctx.quadraticCurveTo(rw * 0.6, cy, rw, tipY);
    ctx.stroke();
    // The pickup comb: nearer the reed for a smaller distance, offset up or down by the axis.
    const gap = 4 + dist * 14, off = (axis - 0.5) * 16;
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(rw - 8, cy + gap + off);
    ctx.lineTo(rw + 8, cy + gap + off);
    ctx.moveTo(rw - 8, cy - gap + off);
    ctx.lineTo(rw + 8, cy - gap + off);
    ctx.stroke();
    // The hammer: a blue dot whose size is its hardness.
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.arc(rw * 0.55, cy + 10, 2 + hard * 4, 0, Math.PI * 2);
    ctx.fill();
    // The note it rings: harder hammer = more harmonics, closer pickup = more asymmetric bark.
    const x0 = rw + 16, x1 = W - 4, mid = H * 0.5, amp = H * 0.36;
    const asym = (1 - dist) * 0.8, h3 = hard * 0.5, tau = 0.15 + damp * 0.85;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(x0, mid);
    ctx.lineTo(x1, mid);
    ctx.stroke();
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    const n = Math.max(2, Math.floor(x1 - x0));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const env = Math.exp(-t / tau) * (1 - trem * 0.4 * (1 + Math.sin(t * 30)) * 0.5);
      const s = Math.sin(t * 2 * Math.PI * 9);
      const y = (s + h3 * Math.sin(t * 2 * Math.PI * 27) + asym * s * s - asym * 0.5) / (1 + h3 + asym * 0.5);
      const px = x0 + i, py = mid - y * env * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    tag(ctx, "REED", 4, 3, GREY);
    tag(ctx, "HAMMER", 4, H - 11, BLUE);
    tag(ctx, "PICKUP", Math.max(4, W - 40), H - 11, ORANGE);
  },

  eq_curve(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    const bands = [
      ["32 Hz low shelf gain", 32, "low"],
      ["63 Hz peak gain", 63, "peak"],
      ["125 Hz peak gain", 125, "peak"],
      ["250 Hz peak gain", 250, "peak"],
      ["500 Hz peak gain", 500, "peak"],
      ["1 kHz peak gain", 1000, "peak"],
      ["2 kHz peak gain", 2000, "peak"],
      ["4 kHz peak gain", 4000, "peak"],
      ["8 kHz peak gain", 8000, "peak"],
      ["16 kHz high shelf gain", 16000, "high"],
    ].map(([name, f, kind]) => ({ f, kind, g: (clamp(num(params[name], 0.5), 0, 1) - 0.5) * 2 }));
    const lo = Math.log2(20), hi = Math.log2(20000);
    const xOf = (f) => ((Math.log2(f) - lo) / (hi - lo)) * (W - 8) + 4;
    const mid = H / 2, span = H * 0.4;
    const gainAt = (f) => {
      let g = 0;
      for (const b of bands) {
        const d = Math.log2(f / b.f);
        if (b.kind === "low") g += b.g / (1 + Math.exp(d * 4));
        else if (b.kind === "high") g += b.g / (1 + Math.exp(-d * 4));
        else g += b.g * Math.exp(-(d * d) / 0.5);
      }
      return clamp(g, -1, 1);
    };
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(4, mid);
    ctx.lineTo(W - 4, mid);
    ctx.stroke();
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    for (let x = 4; x <= W - 4; x++) {
      const f = Math.pow(2, lo + ((x - 4) / Math.max(1, W - 8)) * (hi - lo));
      const y = mid - gainAt(f) * span;
      if (x === 4) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (const b of bands) {
      const x = xOf(b.f);
      ctx.fillStyle = b.g === 0 ? GREY : ORANGE;
      ctx.beginPath();
      ctx.arc(x, mid - b.g * span, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    tag(ctx, "EQ", 4, 3, GREY);
  },

  rotor(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    glass(ctx, W, H);
    const speed = num(params["Leslie Speed"], 0.5);
    const rate = clamp(num(params["Leslie Rate"], 0.5), 0, 1);
    const depth = clamp(num(params["Leslie High - depth"], 0.5), 0, 1);
    const width = clamp(num(params["Leslie High - width"], 0.5), 0, 1);
    const mode = speed < 0.25 ? 0 : speed < 0.75 ? 1 : 2;
    const rps = [0, 0.8, 6.5][mode] * (0.5 + rate);
    // Turn only while sound is moving; otherwise hold the last angle.
    const t = num(now, 0) / 1000;
    const moving = last(output) > 0.001;
    if (moving) state.angle = num(state.angle, 0) + rps * Math.max(0, Math.min(0.1, t - num(state.t, t))) * Math.PI * 2;
    state.t = t;
    const a = num(state.angle, 0.6);
    const r = Math.max(6, Math.min(H * 0.38, W * 0.2));
    const hx = W * 0.3, dx = W * 0.7, cy = H * 0.5;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.arc(hx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(dx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // The horn: two bells, their length the depth, the throw spread by the width.
    const hl = r * (0.4 + depth * 0.6);
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(hx - Math.cos(a) * hl, cy - Math.sin(a) * hl);
    ctx.lineTo(hx + Math.cos(a) * hl, cy + Math.sin(a) * hl);
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(hx + Math.cos(a) * hl, cy + Math.sin(a) * hl, 2 + width * 3, 0, Math.PI * 2);
    ctx.fill();
    // The drum turns slower, the other way.
    const b = -a * 0.8;
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.moveTo(dx, cy);
    ctx.arc(dx, cy, r * 0.8, b, b + Math.PI * 0.6);
    ctx.closePath();
    ctx.fill();
    tag(ctx, "HORN", 4, 3, GREY);
    tag(ctx, "DRUM", Math.max(4, W - 28), 3, GREY);
    tag(ctx, ["STOP", "SLOW", "FAST"][mode], 4, H - 11, mode === 2 ? RED : mode === 1 ? GREEN : GREY);
  },
};
