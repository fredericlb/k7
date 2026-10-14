// cz-v screens: each line's phase-distortion cycle pair, and its DCW and DCA envelopes.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const SHAPES = ["SAW", "SQR", "PULSE", "DSIN", "SAWP", "RES1", "RES2", "RES3", "CUST"];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const shapeIndex = (v) => clamp(Math.round(num(v, 0) * 8), 0, 8);

// One sample of a CZ waveform at phase x (0..1) with DCW d (0..1): d = 0 is always a sine.
function cz(shape, x, d) {
  const k = 0.5 - 0.49 * d;
  const warp = (p) => (p < k ? (p / k) * 0.5 : 0.5 + ((p - k) / (1 - k)) * 0.5);
  const sq = (p, duty) => {
    const s = Math.sin(2 * Math.PI * (p < duty ? (p / duty) * 0.5 : 0.5 + ((p - duty) / (1 - duty)) * 0.5));
    const g = 1 + 24 * d;
    return Math.tanh(s * g) / Math.tanh(g);
  };
  switch (shape) {
    case 0: return Math.cos(2 * Math.PI * warp(x));
    case 1: return sq(x, 0.5);
    case 2: return sq(x, 0.5 - 0.4 * d);
    case 3: return Math.cos(4 * Math.PI * warp(x));
    case 4: return x < 0.5 ? Math.cos(2 * Math.PI * warp(x * 2)) : sq(x * 2 - 1, 0.5 - 0.4 * d);
    case 5: case 6: case 7: {
      const win = shape === 5 ? 1 - x : shape === 6 ? 1 - Math.abs(2 * x - 1) : Math.min(1, 4 * (1 - x));
      const r = Math.cos(2 * Math.PI * x * (1 + 14 * d));
      return (1 - d) * Math.cos(2 * Math.PI * x) + d * win * r;
    }
    default: return Math.cos(2 * Math.PI * x);
  }
}

function waveScreen(lcd, n) {
  const { ctx, width: W, height: H, params } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const L = `Line ${n} `;
  const a = shapeIndex(params[`${L}Shape A`]);
  const b = shapeIndex(params[`${L}Shape B`]);
  const d = clamp(num(params[`${L}DCW`], 0), 0, 1);
  const top = 14, bot = H - 6, mid = (top + bot) / 2, amp = Math.max(1, (bot - top) / 2 - 2);
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(4, mid); ctx.lineTo(W - 4, mid);
  ctx.moveTo(W / 2, top); ctx.lineTo(W / 2, bot);
  ctx.stroke();
  const half = Math.max(1, (W - 8) / 2);
  for (const [i, shape, col] of [[0, a, BLUE], [1, b, WHITE]]) {
    ctx.strokeStyle = col;
    ctx.beginPath();
    for (let px = 0; px <= half; px++) {
      const y = clamp(cz(shape, px / half, d), -1, 1);
      const X = 4 + i * half + px, Y = mid - y * amp;
      if (px === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = BLUE;
  ctx.fillText(`A ${SHAPES[a]}`, 4, 3);
  ctx.fillStyle = WHITE;
  ctx.fillText(`B ${SHAPES[b]}`, W / 2 + 3, 3);
  ctx.fillStyle = ORANGE;
  const t = `DCW ${Math.round(d * 99)}`;
  ctx.fillText(t, W - 4 - ctx.measureText(t).width, 3);
  ctx.fillRect(4, H - 3, (W - 8) * d, 2);
}

// The envelope's breakpoints, x in 0..1 of the drawing width, y in 0..1.
function adsr(params, base) {
  const g = (k, d) => clamp(num(params[`${base} ${k}`], d), 0, 1);
  const dl = g("Delay", 0), a = g("Attack", 0), dc = g("Decay", 0), pk = g("Peak", 1), s = g("Sustain", 1), r = g("Release", 0);
  const seg = [dl * 0.6, 0.02 + a, 0.02 + dc, 0.35, 0.02 + r];
  const tot = seg.reduce((x, y) => x + y, 0) || 1;
  let x = 0;
  const pts = [[0, 0]];
  const ys = [0, pk, pk * s, pk * s, 0];
  for (let i = 0; i < seg.length; i++) { x += seg[i] / tot; pts.push([x, ys[i]]); }
  return pts;
}

function envScreen(lcd, n) {
  const { ctx, width: W, height: H, params, output, state, now } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const L = `Line ${n} `;
  const left = 4, right = W - 10, top = 14, bot = H - 6;
  const w = Math.max(1, right - left), h = Math.max(1, bot - top);
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, bot); ctx.lineTo(right, bot); ctx.stroke();
  const draw = (base, col) => {
    const pts = adsr(params, base);
    ctx.strokeStyle = col;
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const X = left + x * w, Y = bot - y * h; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.stroke();
    ctx.fillStyle = col;
    for (const [x, y] of pts.slice(1, -1)) ctx.fillRect(left + x * w - 1, bot - y * h - 1, 3, 3);
  };
  draw(`${L}DCW ADSR`, ORANGE);
  draw(`${L}Amp ADSR`, GREEN);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = ORANGE; ctx.fillText("DCW", left, 3);
  ctx.fillStyle = GREEN; ctx.fillText("DCA", left + 24, 3);
  const last = Array.isArray(output) && output.length ? num(output[output.length - 1], 0) : 0;
  state.lvl = Math.max(clamp(last, 0, 1), num(state.lvl, 0) * 0.85);
  ctx.fillStyle = state.lvl > 0.9 ? "#ff3b30" : WHITE;
  const bh = h * state.lvl;
  ctx.fillRect(W - 6, bot - bh, 3, bh);
  if (state.lvl > 0.01) {
    const pts = adsr(params, `${L}Amp ADSR`);
    const p = pts[2] ?? [0.5, 1];
    const pulse = 1.5 + Math.sin(num(now, 0) / 180);
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(left + p[0] * w, bot - p[1] * h, pulse + 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default {
  wave1(lcd) { waveScreen(lcd, 1); },
  wave2(lcd) { waveScreen(lcd, 2); },
  env1(lcd) { envScreen(lcd, 1); },
  env2(lcd) { envScreen(lcd, 2); },
};
