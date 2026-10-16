// flanger — the feedback comb's response at the sweep's centre, with its two extremes and the live position.

const LIVE = "#ff6a1a";
const CENTRE = "#ffffff";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const F_LO = 20;
const F_HI = 20000;
const DB_FLOOR = -30;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Wet path of jsdsp.ts: y = x + z^-D x / (1 - g z^-D), so |H| = |1 + (1-g)e^-jθ| / |1 - g e^-jθ|, in dB below its peak.
function combDb(f, tauMs, g) {
  const th = 2 * Math.PI * f * (tauMs / 1000);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const k = 1 - g;
  const num = Math.hypot(1 + k * c, k * s);
  const den = Math.max(1e-6, Math.hypot(1 - g * c, g * s));
  const peak = (1 + k) / Math.max(1e-6, 1 - g);
  const mag = num / den / Math.max(1e-6, peak);
  return Math.max(DB_FLOOR, 20 * Math.log10(Math.max(1e-6, mag)));
}

function curve(ctx, pad, top, w, h, tauMs, g) {
  ctx.beginPath();
  for (let i = 0; i <= w; i++) {
    const f = F_LO * (F_HI / F_LO) ** (i / w);
    const y = top + (combDb(f, tauMs, g) / DB_FLOOR) * h;
    if (i === 0) ctx.moveTo(pad + i, y);
    else ctx.lineTo(pad + i, y);
  }
  ctx.stroke();
}

export default {
  comb(lcd) {
    const { ctx, width: W, height: H, params, output, state, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;

    const pad = 6;
    const top = 14;
    const w = Math.max(1, W - pad * 2);
    const h = Math.max(1, H - top - pad);

    const rate = Math.max(0, params["Rate"] ?? 0.4);
    const depth = Math.max(0, params["Depth"] ?? 3);
    const centre = Math.max(0.05, params["Centre"] ?? 5);
    const g = Math.max(0, Math.min(0.9, params["Feedback"] ?? 0.5));
    const lo = Math.max(0.05, centre - depth);
    const hi = centre + depth;

    // The two ends of the sweep, faint.
    ctx.strokeStyle = GRID;
    curve(ctx, pad, top, w, h, lo, g);
    curve(ctx, pad, top, w, h, hi, g);

    // The comb where the LFO is now while audio flows; at rest, the centre.
    const out = Array.isArray(output) && output.length ? clamp01(output[output.length - 1] ?? 0) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    const moving = state.out > 0.02;
    const tau = moving ? Math.max(0.05, centre + depth * Math.sin(2 * Math.PI * rate * (now / 1000))) : centre;
    ctx.strokeStyle = moving ? LIVE : CENTRE;
    curve(ctx, pad, top, w, h, tau, g);

    ctx.fillStyle = CENTRE;
    ctx.textAlign = "left";
    ctx.fillText(`${centre.toFixed(1)} ±${depth.toFixed(1)} MS`, pad, 9);
    ctx.fillStyle = GRID;
    ctx.textAlign = "right";
    ctx.fillText(`${rate.toFixed(2)} HZ  FB ${Math.round(g * 100)}%`, W - pad, 9);
  },
};
