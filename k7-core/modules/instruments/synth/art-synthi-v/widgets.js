// Synthi V screens: the filter's response, the trapezoid envelope, the modulation step sequence. Params are normalized 0..1.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));
const p = (params, name, def) => clamp(params[name] ?? def, 0, 1);

function glass(lcd) {
  const { ctx, width: W, height: H } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.lineWidth = 1;
}

function level(arr) {
  if (!arr || !arr.length) return 0;
  let m = 0;
  for (let i = Math.max(0, arr.length - 8); i < arr.length; i++) m = Math.max(m, arr[i] || 0);
  return clamp(m, 0, 1);
}

export default {
  vcf_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, output } = lcd;
    const cut = p(params, "Filter Cutoff Frequency", 0.5);
    const res = p(params, "Filter Response", 0.5);
    const top = 12, bot = H - 3, h = bot - top, base = top + h * 0.5;
    ctx.fillStyle = WHITE;
    ctx.fillText("VCF", 3, 2);
    const fc = 0.05 + cut * 0.9, q = 0.5 + res * 8;
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const r = Math.pow(10, (x / Math.max(1, W) - fc) * 3);
      const g = Math.pow(1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2)), 1.5);
      const y = clamp(base - (20 * Math.log10(Math.max(1e-6, g)) / 40) * h, top, bot);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(fc * W, base - res * 0.35 * h, 2 + 2 * level(output), 0, Math.PI * 2);
    ctx.fill();
  },

  env_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params, now, output } = lcd;
    const a = p(params, "Envelope Shaper Attack Time", 0);
    const on = p(params, "Envelope Shaper On Time", 0);
    const d = p(params, "Envelope Shaper Decay Time", 0.5);
    const off = p(params, "Envelope Shaper Off Time", 1);
    const trap = p(params, "Envelope Trapezoid Level", 0.5);
    const sig = p(params, "Envelope Signal Level", 0.5);
    ctx.fillStyle = GREEN;
    ctx.fillText("TRAPEZOID", 3, 2);
    const top = 13, bot = H - 4, h = bot - top;
    const segs = [0.04 + a, 0.04 + on, 0.04 + d, 0.04 + off];
    const total = segs.reduce((s, v) => s + v, 0);
    const looping = off < 0.99;
    const periods = looping ? 2 : 1;
    const pw = (W - 6) / periods;
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    for (let k = 0; k < periods; k++) {
      let x = 3 + k * pw;
      const sx = (v) => (v / total) * pw;
      if (k === 0) ctx.moveTo(x, bot);
      x += sx(segs[0]);
      ctx.lineTo(x, bot - trap * h);
      x += sx(segs[1]);
      ctx.lineTo(x, bot - trap * h);
      x += sx(segs[2]);
      ctx.lineTo(x, bot);
      x += sx(segs[3]);
      ctx.lineTo(x, bot);
    }
    ctx.stroke();
    ctx.fillStyle = BLUE;
    ctx.fillRect(W - 4, bot - sig * h, 2, sig * h);
    ctx.fillStyle = GREY;
    const tag = looping ? "LOOP" : "ONE";
    ctx.fillText(tag, W - 8 - ctx.measureText(tag).width, 2);
    const lv = level(output);
    if (lv > 0.001) {
      const t = ((now / 1000) * 0.5) % 1;
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.arc(3 + t * (W - 6), bot - lv * h, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  seq_screen(lcd) {
    glass(lcd);
    const { ctx, width: W, height: H, params } = lcd;
    const n = 1 + Math.round(p(params, "Modulations Step Sequencer NbSteps", 15 / 31) * 31);
    const cur = Math.round(p(params, "Modulations Step Sequencer CurrentStep", 0) * 31);
    const smooth = p(params, "Modulations Step Sequencer Smooth", 0);
    const modes = ["FWD", "BWD", "PING", "RND"];
    const mode = modes[Math.round(p(params, "Modulations Step Sequencer LoopMode", 0) * 3)] ?? "";
    ctx.fillStyle = WHITE;
    ctx.fillText(`STEPS ${n}`, 3, 2);
    ctx.fillStyle = GREY;
    ctx.fillText(mode, W - 3 - ctx.measureText(mode).width, 2);
    const top = 13, bot = H - 3, h = bot - top, mid = top + h / 2;
    const bw = (W - 6) / Math.max(1, n);
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(3, mid + 0.5);
    ctx.lineTo(W - 3, mid + 0.5);
    ctx.stroke();
    const pts = [];
    for (let i = 0; i < n; i++) {
      const v = p(params, `Modulations Step Sequencer StepVal${i + 1}`, 0.5);
      const y = bot - v * h;
      const x = 3 + i * bw;
      ctx.fillStyle = i === cur ? ORANGE : BLUE;
      const top2 = Math.min(y, mid), hh = Math.max(1, Math.abs(y - mid));
      ctx.fillRect(x + 1, top2, Math.max(1, bw - 2), hh);
      pts.push([x + bw / 2, y]);
    }
    if (smooth > 0.02 && pts.length > 1) {
      ctx.strokeStyle = WHITE;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.fillStyle = RED;
    ctx.fillRect(3 + cur * bw, bot + 1, Math.max(1, bw), 1);
  },
};
