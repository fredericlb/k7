// OP-Xa V screens: the filter's curve, the two ADSRs, and the two oscillators' summed wave.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = FONT;
  ctx.textBaseline = "top";
}

function lastPeak(arr) {
  return Array.isArray(arr) && arr.length ? Math.min(1, Math.max(0, arr[arr.length - 1] || 0)) : 0;
}

function on(v) {
  return (v ?? 0) >= 0.5;
}

// One OP-Xa oscillator sample: saw and pulse switches add, as on the panel.
function osc(saw, pulse, pw, p) {
  let v = 0, n = 0;
  if (saw) { v += 1 - 2 * p; n++; }
  if (pulse) { v += p < 0.5 - pw * 0.45 ? 1 : -1; n++; }
  return n ? v / n : 0;
}

function adsr(ctx, x0, y0, w, h, a, d, s, r) {
  const ta = 0.04 + a, td = 0.04 + d, th = 0.35, tr = 0.04 + r;
  const sx = w / (ta + td + th + tr);
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h);
  ctx.lineTo(x0 + ta * sx, y0);
  let x = x0 + ta * sx;
  for (let k = 1; k <= 12; k++) ctx.lineTo(x + (td * sx * k) / 12, y0 + h - h * (s + (1 - s) * Math.exp((-4 * k) / 12)));
  x += td * sx;
  ctx.lineTo(x + th * sx, y0 + h - h * s);
  x += th * sx;
  for (let k = 1; k <= 12; k++) ctx.lineTo(x + (tr * sx * k) / 12, y0 + h - h * s * Math.exp((-4 * k) / 12));
  ctx.stroke();
}

export default {
  filt_screen(lcd) {
    const { ctx, width: W, height: H, params: P, output, state } = lcd;
    glass(ctx, W, H);
    const cut = P["Filter Frequency"] ?? 0.5, res = P["Filter Resonance"] ?? 0, env = P["Filter Modulation"] ?? 0;
    const fourPole = !on(P["Filter 4 P / 2 P"]);
    state.mov = (state.mov ?? 0) * 0.7 + lastPeak(output) * 0.3;
    const top = 11, bot = H - 3, slope = fourPole ? 7 : 3.5;
    const curve = (c, col) => {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const r = x / W - c;
        const roll = r > 0 ? Math.min(1, r * slope) : 0;
        const g = (1 - roll) * 0.6 + res * 0.7 * Math.exp(-(r * r) / 0.0015);
        const y = Math.max(top, bot - (bot - top) * Math.min(1, g));
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    if (state.mov > 0.01 && env > 0.01) curve(Math.min(0.98, cut + env * state.mov * 0.3), BLUE);
    curve(cut, ORANGE);
    ctx.fillStyle = WHITE;
    ctx.fillText(fourPole ? "24DB" : "12DB", 3, 1);
    ctx.fillStyle = ORANGE;
    ctx.fillText(`${Math.round(cut * 100)}`, W - 18, 1);
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params: P } = lcd;
    glass(ctx, W, H);
    const top = 11, h = H - top - 3;
    ctx.strokeStyle = ORANGE;
    adsr(ctx, 2, top, W - 4, h, P["Filter Attack"] ?? 0, P["Filter Decay"] ?? 0.35, P["Filter Sustain"] ?? 1, P["Filter Release"] ?? 0);
    ctx.strokeStyle = GREEN;
    adsr(ctx, 2, top, W - 4, h, P["Loudness Attack"] ?? 0, P["Loudness Decay"] ?? 0.35, P["Loudness Sustain"] ?? 1, P["Loudness Release"] ?? 0);
    ctx.fillStyle = ORANGE;
    ctx.fillText("FILT", 3, 1);
    ctx.fillStyle = GREEN;
    ctx.fillText("AMP", 30, 1);
  },

  osc_screen(lcd) {
    const { ctx, width: W, height: H, params: P, output } = lcd;
    glass(ctx, W, H);
    const pw = P["Oscillators PW"] ?? 0;
    const oct = Math.round((P["Osc 1 Frequency"] ?? 0.5) * 4);
    const c1 = Math.max(0.5, 2 * Math.pow(2, oct - 2));
    const semi = Math.round((P["Osc 2 Frequency"] ?? 0) * 60);
    const det = ((P["Osc 2 Detune"] ?? 0.5) - 0.5) * 0.06;
    const c2 = c1 * Math.pow(2, semi / 12 - 1) * (1 + det);
    const l1 = P["Osc 1 Level"] ?? 1, l2 = P["Osc 2 Level"] ?? 1, nz = P["Noise Level"] ?? 0;
    const s1 = on(P["Osc 1 Saw"]), p1 = on(P["Osc 1 Pulse"]), s2 = on(P["Osc 2 Saw"]), p2 = on(P["Osc 2 Pulse"]);
    const sync = on(P["Osc Sync"]);
    const mid = H / 2 + 4, amp = H / 2 - 8;
    const o1 = (t) => osc(s1, p1, pw, (t * c1) % 1);
    const o2 = (t) => osc(s2, p2, pw, sync ? ((t * c1) % 1 * (c2 / c1)) % 1 : (t * c2) % 1);
    const line = (fn, col, alpha) => {
      ctx.strokeStyle = col;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const y = mid - fn(x / W) * amp;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    line(o1, WHITE, 0.3);
    line(o2, BLUE, 0.4);
    const sum = l1 + l2 + nz * 0.5 || 1;
    line((t) => (o1(t) * l1 + o2(t) * l2 + nz * 0.5 * Math.sin(t * 9301 + 49297 * t * t)) / sum, WHITE, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = WHITE;
    ctx.fillText("O1", 3, 1);
    ctx.fillStyle = BLUE;
    ctx.fillText(`O2 +${semi}${sync ? " SYNC" : ""}`, 20, 1);
    const pk = lastPeak(output);
    ctx.fillStyle = GREY;
    ctx.fillRect(W - 4, 10, 3, H - 12);
    ctx.fillStyle = ORANGE;
    ctx.fillRect(W - 4, H - 2 - pk * (H - 12), 3, pk * (H - 12));
  },
};
