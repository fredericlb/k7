// Screens for SQ80 V: the VCF's response, the amp envelope's shape, the three LFOs.
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const WHITE = "#ffffff";
const GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

function last(arr) {
  return arr && arr.length ? clamp(arr[arr.length - 1], 0, 1) : 0;
}

function text(ctx, s, x, y, color, align) {
  ctx.font = FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "top";
  ctx.fillText(s, x, y);
}

// One cycle of an LFO shape at phase p in 0..1, value in -1..1.
function lfoShape(kind, p, seed) {
  const f = p - Math.floor(p);
  if (kind === 0) return f < 0.5 ? 4 * f - 1 : 3 - 4 * f;
  if (kind === 1) return 1 - 2 * f;
  if (kind === 2) return f < 0.5 ? 1 : -1;
  if (kind === 3) {
    const n = Math.sin((Math.floor(p * 4) + seed) * 12.9898) * 43758.5453;
    return 2 * (n - Math.floor(n)) - 1;
  }
  if (kind === 4) return Math.sin(f * Math.PI * 2);
  return 2 * f - 1;
}

export default {
  filter_screen(lcd) {
    const { ctx, width: W, height: H, params, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (W < 20 || H < 20) return;
    const cut = clamp(params["Filter Cutoff Frequency"] ?? 1, 0, 1);
    const res = clamp(params["Filter Resonance"] ?? 0, 0, 1);
    const kt = clamp(params["Filter Keyboard Tracking"] ?? 0, 0, 1);
    const top = 6;
    const bot = H - 12;
    ctx.strokeStyle = GREY;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bot + 0.5);
    ctx.lineTo(W, bot + 0.5);
    ctx.stroke();
    // Four-pole lowpass magnitude on a log-frequency axis, x in 0..1.
    const fc = 0.02 + cut * 0.96;
    const q = 0.5 + res * 6;
    const yOf = (x) => {
      const r = Math.pow(10, (x - fc) * 3);
      const one = 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
      const db = 20 * Math.log10(Math.max(1e-6, one * one));
      const t = clamp((db + 48) / 66, 0, 1);
      return bot - t * (bot - top);
    };
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    for (let px = 0; px <= W; px += 2) {
      const y = yOf(px / W);
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
    const cx = fc * W;
    const lvl = last(output);
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(cx, yOf(fc), 2.5 + lvl * 3, 0, Math.PI * 2);
    ctx.fill();
    // Key tracking: a short white tick sliding right of the cutoff by its amount.
    if (kt > 0.01) {
      ctx.strokeStyle = WHITE;
      ctx.beginPath();
      ctx.moveTo(cx, bot + 3.5);
      ctx.lineTo(Math.min(W - 1, cx + kt * W * 0.25), bot + 3.5);
      ctx.stroke();
    }
    text(ctx, "VCF", 3, 2, GREY);
    text(ctx, `RES ${Math.round(res * 100)}`, W - 3, 2, GREY, "right");
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params, output, state } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (W < 20 || H < 20) return;
    const g = (k, d) => clamp(params[k] ?? d, 0, 1);
    const t = [g("Envelope4 SQ80 Time 1", 0), g("Envelope4 SQ80 Time 2", 0), g("Envelope4 SQ80 Time 3", 0), g("Envelope4 SQ80 Release Time", 0)];
    const l = [g("Envelope4 SQ80 Level 1", 0.5), g("Envelope4 SQ80 Level 2", 0.5), g("Envelope4 SQ80 Level 3", 1)];
    const top = 12;
    const bot = H - 4;
    const yOf = (v) => bot - v * (bot - top);
    const segs = t.map((v) => 0.04 + v);
    const hold = 0.35;
    const total = segs.reduce((a, b) => a + b, 0) + hold;
    const sx = (W - 8) / total;
    const pts = [[4, yOf(0)]];
    let x = 4;
    for (let k = 0; k < 3; k++) {
      x += segs[k] * sx;
      pts.push([x, yOf(l[k])]);
    }
    x += hold * sx;
    pts.push([x, yOf(l[2])]);
    x += segs[3] * sx;
    pts.push([x, yOf(0)]);
    ctx.strokeStyle = GREY;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bot + 0.5);
    ctx.lineTo(W, bot + 0.5);
    ctx.stroke();
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
    ctx.fillStyle = GREEN;
    for (let k = 1; k < 4; k++) {
      ctx.fillRect(pts[k][0] - 1.5, pts[k][1] - 1.5, 3, 3);
    }
    // The live output level as a white dot riding the sustain plateau.
    const lvl = last(output);
    state.lvl = (state.lvl ?? 0) * 0.6 + lvl * 0.4;
    if (state.lvl > 0.01) {
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.arc((pts[3][0] + pts[4][0]) / 2, yOf(clamp(state.lvl, 0, 1)), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    text(ctx, "AMP ENV", 3, 2, GREY);
    text(ctx, ["T1", "T2", "T3", "REL"].map((n, k) => `${n} ${Math.round(t[k] * 63)}`).join("  "), W - 3, 2, GREY, "right");
  },

  lfo_screen(lcd) {
    const { ctx, width: W, height: H, params, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (W < 20 || H < 30) return;
    const colors = [BLUE, GREEN, ORANGE];
    const rowH = H / 3;
    for (let i = 0; i < 3; i++) {
      const n = `LFO${i + 1}`;
      const rate = clamp(params[`${n} Rate Unsync`] ?? 0.15, 0, 1);
      const amp = clamp(params[`${n} Amplitude`] ?? 1, 0, 1);
      const delay = clamp(params[`${n} Delay`] ?? 0, 0, 1);
      const kind = Math.round(clamp(params[`${n} Waveform`] ?? 0, 0, 1) * 5);
      const mid = rowH * i + rowH / 2 + 4;
      const half = (rowH / 2 - 6) * amp;
      const cycles = 1 + rate * 7;
      const x0 = delay * W * 0.4;
      const phase = (now / 1000) * (0.2 + rate * 2);
      ctx.strokeStyle = GREY;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(W, mid + 0.5);
      ctx.stroke();
      ctx.strokeStyle = colors[i];
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(x0, mid);
      for (let px = x0; px <= W; px += 1) {
        const ramp = delay > 0 ? clamp((px - x0) / (W * 0.2), 0, 1) : 1;
        const p = ((px - x0) / Math.max(1, W - x0)) * cycles + phase;
        ctx.lineTo(px, mid - lfoShape(kind, p, i) * half * ramp);
      }
      ctx.stroke();
      text(ctx, `${i + 1}`, 2, rowH * i + 1, colors[i]);
    }
  },
};
