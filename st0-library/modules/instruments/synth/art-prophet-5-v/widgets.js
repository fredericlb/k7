// prophet-5-v screens: the two oscillators as the mixer hears them, and the LFO's summed wave.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const on = (v) => num(v, 0) >= 0.5;

function black(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
}

// A sum of the switched-on waves at phase x, normalised to -1..1; null when nothing is on.
function mixWaves(x, saw, tri, sqr, pw) {
  let s = 0, n = 0;
  if (saw) { s += 1 - 2 * x; n++; }
  if (tri) { s += x < 0.5 ? 4 * x - 1 : 3 - 4 * x; n++; }
  if (sqr) { s += x < pw ? 1 : -1; n++; }
  return n ? s / n : null;
}

function trace(ctx, x0, w, mid, amp, f, col) {
  ctx.strokeStyle = col;
  ctx.beginPath();
  let started = false;
  for (let px = 0; px <= w; px++) {
    const y = f(px / Math.max(1, w));
    if (y === null) return false;
    const Y = mid - clamp(y, -1, 1) * amp;
    if (started) ctx.lineTo(x0 + px, Y); else { ctx.moveTo(x0 + px, Y); started = true; }
  }
  ctx.stroke();
  return true;
}

function oscScreen(lcd) {
  const { ctx, width: W, height: H, params: p } = lcd;
  black(ctx, W, H);
  const rows = [
    { name: "A", col: BLUE, lvl: num(p["VCO 1 Level"], 1), saw: on(p["SawOn1"]), tri: false, sqr: on(p["VCO 1 Square"]), pw: num(p["VCO 1 Pulse Width"], 0.5), cyc: 2 },
    { name: "B", col: GREEN, lvl: num(p["VCO 2 Level"], 1), saw: on(p["VCO 2 Saw"]), tri: on(p["VCO 2 Triangle"]), sqr: on(p["VCO 2 Square"]), pw: num(p["VCO 2 Pulse Width"], 0.5), cyc: on(p["VCO 2 LFO Mode"]) ? 1 : 2 + Math.round(4 * (num(p["VCO 2 Fine Tune"], 0.5) - 0.5)) },
  ];
  const band = (H - 4) / 2;
  ctx.font = FONT;
  ctx.textBaseline = "top";
  rows.forEach((r, i) => {
    const mid = 2 + band * i + band / 2, amp = Math.max(1, (band / 2 - 3) * clamp(r.lvl, 0.08, 1));
    ctx.strokeStyle = GREY;
    ctx.beginPath(); ctx.moveTo(14, mid); ctx.lineTo(W - 4, mid); ctx.stroke();
    const pw = clamp(0.05 + 0.9 * r.pw, 0.05, 0.95);
    const drawn = trace(ctx, 14, W - 18, mid, amp, (x) => mixWaves((x * Math.max(1, r.cyc)) % 1, r.saw, r.tri, r.sqr, pw), r.col);
    ctx.fillStyle = drawn ? r.col : GREY;
    ctx.fillText(r.name, 3, mid - 4);
  });
  const noise = clamp(num(p["Noise Level"], 0), 0, 1);
  if (noise > 0.01) {
    ctx.fillStyle = WHITE;
    const n = Math.round(noise * 40);
    for (let i = 0; i < n; i++) {
      const x = 14 + ((i * 37) % Math.max(1, W - 18));
      const y = 2 + ((i * 53 + 11) % Math.max(1, H - 4));
      ctx.fillRect(x, y, 1, 1);
    }
  }
  if (on(p["VCO 1 Sync"])) {
    ctx.fillStyle = ORANGE;
    ctx.fillText("SYNC", W - 26, 2);
  }
}

function lfoScreen(lcd) {
  const { ctx, width: W, height: H, params: p, now } = lcd;
  black(ctx, W, H);
  const saw = on(p["LFO Ramp"]), tri = on(p["LFO Triangle"]), sqr = on(p["LFO Square"]);
  const rate = clamp(num(p["LFO Rate Unsynced"], 0.5), 0, 1);
  const cycles = 1 + Math.round(rate * 5);
  const mid = H / 2 + 4, amp = Math.max(1, H / 2 - 8);
  ctx.strokeStyle = GREY;
  ctx.beginPath(); ctx.moveTo(3, mid); ctx.lineTo(W - 3, mid); ctx.stroke();
  const f = (x) => mixWaves((x * cycles) % 1, saw, tri, sqr, 0.5);
  const drawn = trace(ctx, 3, W - 6, mid, amp, f, WHITE);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = drawn ? WHITE : GREY;
  ctx.fillText(drawn ? [saw && "SAW", tri && "TRI", sqr && "SQR"].filter(Boolean).join("+") : "NO WAVE", 3, 2);
  if (drawn) {
    const ph = ((num(now, 0) / 1000) * (0.2 + rate * 2)) % 1;
    const y = f(ph / cycles) ?? 0;
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(3 + (ph / cycles) * (W - 6), mid - clamp(y, -1, 1) * amp, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default {
  osc_screen: oscScreen,
  lfo_screen: lfoScreen,
};
