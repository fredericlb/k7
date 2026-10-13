// modular-v3 screens: the three oscillators of driver 1 at their octave and width, and ENV 1 against the VCA.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const OCTAVES = [-10, -2, -1, 0, 1, 2];
const OCT_TAG = ["-10", "-2", "-1", "0", "+1", "+2"];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function black(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
}

function oscScreen(lcd) {
  const { ctx, width: W, height: H, params: p } = lcd;
  black(ctx, W, H);
  const cols = [BLUE, GREEN, WHITE];
  const band = (H - 4) / 3;
  ctx.font = FONT;
  ctx.textBaseline = "top";
  for (let i = 0; i < 3; i++) {
    const n = i + 1;
    const oi = clamp(Math.round(num(p[`Transpose Osc${n}`], 0.6) * 5), 0, 5);
    const tune = num(p[`Tune Osc${n}`], 0.5) - 0.5;
    const cycles = clamp(2 * Math.pow(2, clamp(OCTAVES[oi], -3, 2) + tune), 0.25, 8);
    const width = clamp(num(p[`Width Osc${n}`], 0.5), 0.03, 0.97);
    const gain = clamp(num(p[`Gain Mixer${n}`], 0.5), 0, 1);
    const top = 2 + band * i, mid = top + band / 2;
    const amp = Math.max(1, (band / 2 - 3) * clamp(gain, 0.1, 1));
    const x0 = 22, w = Math.max(1, W - x0 - 4);
    ctx.strokeStyle = GREY;
    ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(W - 4, mid); ctx.stroke();
    ctx.strokeStyle = cols[i];
    ctx.beginPath();
    let prev = null;
    for (let px = 0; px <= w; px++) {
      const ph = ((px / w) * cycles) % 1;
      const y = mid - (ph < width ? 1 : -1) * amp;
      if (prev === null) ctx.moveTo(x0 + px, y);
      else { if (y !== prev) ctx.lineTo(x0 + px, prev); ctx.lineTo(x0 + px, y); }
      prev = y;
    }
    ctx.stroke();
    ctx.fillStyle = cols[i];
    ctx.fillText(`${n}`, 3, mid - 8);
    ctx.fillStyle = GREY;
    ctx.fillText(OCT_TAG[oi], 3, mid);
  }
}

// ADSR breakpoints in 0..1 of the drawing box: attack, decay, a held sustain, release.
function adsr(p, suffix) {
  const g = (k) => clamp(num(p[`${k} ${suffix}`], 0.5), 0, 1);
  const a = 0.02 + g("AttackTime"), d = 0.02 + g("DecayTime"), s = g("SustainLevel"), r = 0.02 + g("ReleaseTime");
  const tot = a + d + 0.5 + r;
  const xa = a / tot, xd = xa + d / tot, xs = xd + 0.5 / tot;
  return [[0, 0], [xa, 1], [xd, s], [xs, s], [1, 0]];
}

function envScreen(lcd) {
  const { ctx, width: W, height: H, params: p, output, state } = lcd;
  black(ctx, W, H);
  const left = 4, right = W - 10, top = 14, bot = H - 6;
  const w = Math.max(1, right - left), h = Math.max(1, bot - top);
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, bot); ctx.lineTo(right, bot); ctx.stroke();
  for (const [suffix, col] of [["Env1", ORANGE], ["Vca1", GREEN]]) {
    const pts = adsr(p, suffix);
    ctx.strokeStyle = col;
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const X = left + x * w, Y = bot - y * h; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.stroke();
    ctx.fillStyle = col;
    for (const [x, y] of pts.slice(1, -1)) ctx.fillRect(left + x * w - 1, bot - y * h - 1, 3, 3);
  }
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = ORANGE; ctx.fillText("ENV1", left, 3);
  ctx.fillStyle = GREEN; ctx.fillText("VCA", left + 30, 3);
  const last = Array.isArray(output) && output.length ? num(output[output.length - 1], 0) : 0;
  state.lvl = Math.max(clamp(last, 0, 1), num(state.lvl, 0) * 0.85);
  ctx.fillStyle = state.lvl > 0.9 ? "#ff3b30" : WHITE;
  const bh = h * state.lvl;
  ctx.fillRect(W - 6, bot - bh, 3, bh);
}

export default {
  osc_screen: oscScreen,
  env_screen: envScreen,
};
