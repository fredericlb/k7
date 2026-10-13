// Screens for Solina V2: the swell of the upper and bass strings, and the resonator's three peaks.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const on = (params, name) => num(params[name], 0) >= 0.5;

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = FONT;
  ctx.textBaseline = "top";
}

// One swell: rise over the crescendo, hold while the key is down, fall over its sustain.
function swell(ctx, x0, x1, top, bottom, cresc, level, sus, color, wobble) {
  const w = x1 - x0, h = (bottom - top) * level;
  const ax = x0 + 2 + cresc * w * 0.35, hx = x0 + w * 0.6, rx = hx + 2 + sus * (x1 - hx - 2);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  for (let x = x0; x <= rx; x++) {
    let g;
    if (x < ax) g = 1 - Math.pow(1 - (x - x0) / Math.max(1, ax - x0), 2);
    else if (x < hx) g = 1;
    else g = Math.exp(-((x - hx) / Math.max(1, rx - hx)) * 3);
    const y = bottom - g * h + (x >= ax && x < hx ? Math.sin(x * 0.5) * wobble : 0);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(rx, bottom);
  ctx.stroke();
}

const VOICES = [
  ["Contrabass", "CB", BLUE],
  ["Cello", "CE", BLUE],
  ["Viola", "VA", WHITE],
  ["Violin", "VN", WHITE],
  ["Horn", "HN", ORANGE],
  ["Trumpet", "TP", ORANGE],
  ["Humana", "CH", GREEN],
];

export default {
  shape(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    const cresc = clamp(num(params["Crescendo"], 0.1), 0, 1);
    const ens = on(params, "Ensemble On/Off");
    const top = 12, bottom = H - 3;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(4, bottom);
    ctx.lineTo(W - 4, bottom);
    ctx.stroke();
    const wob = ens ? 1.5 : 0;
    swell(ctx, 4, W - 4, top, bottom, cresc, clamp(num(params["Bass Volume"], 1), 0, 1) * 0.7, clamp(num(params["Bass Sustain"], 0.47), 0, 1), BLUE, 0);
    swell(ctx, 4, W - 4, top, bottom, cresc, clamp(num(params["Upper Volume"], 1), 0, 1), clamp(num(params["Upper Sustain"], 0.19), 0, 1), WHITE, wob);
    // The stops in a row along the top, lit when drawn.
    VOICES.forEach(([name, short, color], i) => {
      ctx.fillStyle = on(params, name) ? color : "#333";
      ctx.fillText(short, 4 + i * 14, 2);
    });
    if (ens) {
      ctx.fillStyle = GREEN;
      ctx.fillText("ENS", Math.max(4, W - 20), 2);
    }
  },

  reso_curve(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    const mode = num(params["Resonator Mode"], 0);
    const kind = mode < 0.17 ? 0 : mode < 0.5 ? 1 : mode < 0.83 ? 2 : 3;
    const bands = [1, 2, 3].map((k) => ({
      f: clamp(num(params[`Resonator Cutoff ${k}`], 0.5), 0, 1),
      g: clamp(num(params[`Resonator Gain ${k}`], 0.5), 0, 1),
      q: clamp(num(params[`Resonator Resonance ${k}`], 0.5), 0, 1),
    }));
    const top = 12, bottom = H - 3, mid = (top + bottom) / 2, span = (bottom - top) / 2;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(3, mid);
    ctx.lineTo(W - 3, mid);
    ctx.stroke();
    // Each band a peak at its cutoff, its height the gain, its width the resonance; the mode tilts the whole.
    const at = (t) => {
      if (kind === 0) return 0;
      let v = 0;
      for (const b of bands) {
        const d = (t - b.f) / (0.03 + (1 - b.q) * 0.15);
        v += b.g * Math.exp(-d * d);
      }
      const tilt = kind === 1 ? 0.5 - t : kind === 3 ? t - 0.5 : -Math.abs(t - 0.5) * 0.6;
      return clamp(v * 0.8 + tilt * 0.6 - 0.3, -1, 1);
    };
    ctx.strokeStyle = kind === 0 ? GREY : WHITE;
    ctx.beginPath();
    for (let x = 3; x <= W - 3; x++) {
      const y = mid - at((x - 3) / Math.max(1, W - 6)) * span;
      if (x === 3) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (kind) {
      const cols = [BLUE, ORANGE, RED];
      bands.forEach((b, i) => {
        ctx.fillStyle = cols[i];
        ctx.beginPath();
        ctx.arc(3 + b.f * (W - 6), mid - at(b.f) * span, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.fillStyle = kind ? ORANGE : GREY;
    ctx.fillText(["BYPASS", "LOW", "BAND", "HIGH"][kind], 3, 2);
  },
};
