// mu-plaits screens — a sketch of the macro wave (not the model's exact output), and the low-pass gate's strike.
const FONT = "8px ui-monospace, monospace";
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const MODELS = ["VA+FILTER", "PHASE DIST", "6-OP FM 1", "6-OP FM 2", "6-OP FM 3", "WAVE TERRAIN", "STRING MACH", "CHIPTUNE", "VIRTUAL ANA", "WAVESHAPING", "2-OP FM", "GRAN FORMANT", "HARMONIC", "WAVETABLE", "CHORDS", "SPEECH", "SWARM", "FILT NOISE", "PART NOISE", "INHARM STR", "MODAL RES", "BASS DRUM", "SNARE DRUM", "HI-HAT"];

function num(p, k, d) {
  const v = p ? p[k] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

// Harmonics adds partials, Timbre bends the phase, Morph drives the sum toward a square.
function macro(ph, harm, timbre, morph) {
  const bent = Math.pow(ph, 1 + timbre * 3) * 2 * Math.PI;
  const count = 1 + Math.floor(harm * 11);
  let s = 0;
  for (let k = 1; k <= count; k++) s += Math.sin(bent * k) / k;
  return Math.tanh(s * (1 + morph * 6)) / Math.tanh(1 + morph * 6);
}

export default {
  osc(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;
    const harm = num(p, "Harmonics", 0.5);
    const timbre = num(p, "Timbre", 0.5);
    const morph = num(p, "Morph", 0.5);
    const model = Math.round(num(p, "Model", 0));
    const x0 = 4;
    const w = Math.max(1, W - 8);
    const top = 16;
    const mid = top + (H - top - 4) / 2;
    const half = Math.max(1, (H - top - 4) / 2);
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(mid) + 0.5);
    ctx.lineTo(x0 + w, Math.round(mid) + 0.5);
    ctx.stroke();
    ctx.strokeStyle = BLUE;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
      const ph = ((i / w) * 2) % 1;
      const y = mid - clamp(macro(ph, harm, timbre, morph), -1, 1) * half;
      if (i === 0) ctx.moveTo(x0 + i, y);
      else ctx.lineTo(x0 + i, y);
    }
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.textAlign = "left";
    ctx.fillText(MODELS[model] ?? "VA+FILTER", 6, 10);
  },
  lpg(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;
    const decay = num(p, "Decay", 0.5);
    const colour = num(p, "LPG colour", 0.5);
    const ping = Math.round(num(p, "Envelope", 0)) === 1;
    const x0 = 4;
    const w = Math.max(1, W - 8);
    const top = 16;
    const bot = H - 6;
    const hh = Math.max(1, bot - top);
    const tau = 0.03 + decay * decay * 0.6;
    const env = (t) => (ping ? Math.exp(-t / tau) : t < 0.45 ? 1 : Math.exp(-(t - 0.45) / tau));
    const draw = (color, fn) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const y = bot - clamp(fn(i / w), 0, 1) * hh;
        if (i === 0) ctx.moveTo(x0 + i, y);
        else ctx.lineTo(x0 + i, y);
      }
      ctx.stroke();
    };
    draw(GREEN, (t) => 1 - colour + colour * env(t));
    draw(ORANGE, (t) => Math.pow(env(t), 1 - colour * 0.6));
    ctx.textAlign = "left";
    ctx.fillStyle = WHITE;
    ctx.fillText(ping ? "PING" : "GATE", 6, 10);
    ctx.textAlign = "right";
    ctx.fillStyle = ORANGE;
    ctx.fillText("AMP", W - 26, 10);
    ctx.fillStyle = GREEN;
    ctx.fillText("LPF", W - 6, 10);
  },
};
