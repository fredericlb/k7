// mu-peaks screens — one strip drawing the three drum voices as the hit they would make.
const FONT = "8px ui-monospace, monospace";
const ORANGE = "#ff6a1a";
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const GREY = "#6b6b6b";

function num(p, k, d) {
  const v = p ? p[k] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
function noise(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

// Draws one voice: sample(t) returns [value, envelope] for t in 0..1.
function voice(ctx, x0, w, top, h, name, color, sample) {
  const mid = top + h / 2 + 4;
  const half = Math.max(1, h / 2 - 8);
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + 4, Math.round(mid) + 0.5);
  ctx.lineTo(x0 + w - 4, Math.round(mid) + 0.5);
  ctx.stroke();
  const n = Math.max(2, Math.floor(w - 8));
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const [v] = sample(i / (n - 1), i);
    const y = mid - clamp(v, -1, 1) * half;
    if (i === 0) ctx.moveTo(x0 + 4 + i, y);
    else ctx.lineTo(x0 + 4 + i, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const [, e] = sample(i / (n - 1), i);
    const y = mid - clamp(e, 0, 1) * half;
    if (i === 0) ctx.moveTo(x0 + 4 + i, y);
    else ctx.lineTo(x0 + 4 + i, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = FONT;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.fillText(name, x0 + 6, top + 10);
}

// Integrates a frequency curve into a phase table so pitch sweeps draw correctly.
function phases(n, freq) {
  const out = new Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    out[i] = ph;
    ph += (2 * Math.PI * freq(i / Math.max(1, n - 1))) / Math.max(1, n - 1);
  }
  return out;
}

export default {
  drums(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const cw = W / 3;
    const n = Math.max(2, Math.floor(cw - 8));

    const kPitch = num(p, "Kick pitch", 0.5);
    const kPunch = num(p, "Kick punch", 0.6);
    const kTone = num(p, "Kick tone", 0.5);
    const kDecay = num(p, "Kick decay", 0.5);
    const kPh = phases(n, (t) => (2 + kPitch * 5) * (1 + kPunch * 5 * Math.exp(-t / 0.04)));
    voice(ctx, 0, cw, 0, H, "KICK", ORANGE, (t, i) => {
      const e = Math.exp(-t / (0.06 + kDecay * 0.6));
      const ph = kPh[i] ?? 0;
      return [e * (Math.sin(ph) + kTone * 0.35 * Math.sin(ph * 3)), e];
    });

    const sPitch = num(p, "Snare pitch", 0.5);
    const sSnap = num(p, "Snare snappy", 0.5);
    const sTone = num(p, "Snare tone", 0.5);
    const sDecay = num(p, "Snare decay", 0.5);
    const sF = 5 + sPitch * 8;
    voice(ctx, cw, cw, 0, H, "SNARE", BLUE, (t, i) => {
      const body = Math.exp(-t / (0.04 + sDecay * 0.25));
      const hiss = sSnap * Math.exp(-t / (0.03 + sDecay * 0.45));
      const tw = 2 * Math.PI * sF * t;
      const tone = (1 - sTone) * Math.sin(tw) + sTone * Math.sin(tw * 1.59);
      return [0.7 * body * tone + 0.6 * hiss * noise(i), Math.min(1, Math.max(body, hiss))];
    });

    const fPitch = num(p, "FM drum pitch", 0.5);
    const fFm = num(p, "FM drum FM", 0.5);
    const fNoise = num(p, "FM drum noise", 0.2);
    const fDecay = num(p, "FM drum decay", 0.5);
    const fF = 3 + fPitch * 9;
    voice(ctx, 2 * cw, cw, 0, H, "FM", GREEN, (t, i) => {
      const e = Math.exp(-t / (0.05 + fDecay * 0.6));
      const tw = 2 * Math.PI * fF * t;
      const v = Math.sin(tw + fFm * 5 * e * Math.sin(tw * 1.41)) * (1 - fNoise * 0.6) + fNoise * noise(i + 999);
      return [e * v, e];
    });

    ctx.strokeStyle = GREY;
    ctx.lineWidth = 1;
    for (const x of [cw, 2 * cw]) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 4);
      ctx.lineTo(Math.round(x) + 0.5, H - 4);
      ctx.stroke();
    }
  },
};
