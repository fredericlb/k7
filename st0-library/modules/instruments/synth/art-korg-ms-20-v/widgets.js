// Screens for the MS-20 V panel: the HPF/LPF pair, the two envelopes, and the MG's morphing wave.
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const WHITE = "#ffffff";
const GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function line(ctx, n, fx, fy) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = fx(i);
    const y = fy(i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// A 2-pole response in dB at normalised frequency x; MKII's peak is softer than MKI's scream.
function response(x, cut, peak, high, mk2) {
  const r = Math.pow(2, (x - cut) * 10);
  const q = 0.6 + peak * (mk2 ? 5 : 10);
  const rr = high ? 1 / r : r;
  const mag = 1 / Math.sqrt((1 - rr * rr) * (1 - rr * rr) + (rr / q) * (rr / q));
  return 20 * Math.log10(Math.max(1e-6, mag));
}

function filter_screen(lcd) {
  const { ctx, width: W, height: H, params: p } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const hc = p["HPF Cutoff Frequency"] ?? 0;
  const hp = p["HPF Peak"] ?? 0;
  const lc = p["LPF Cutoff Frequency"] ?? 1;
  const lp = p["LPF Peak"] ?? 0;
  const mk2 = (p["Filter Revision"] ?? 0) >= 0.5;
  const x0 = 4;
  const w = W - 8;
  const top = 14;
  const h = H - top - 6;
  const zero = top + h * 0.45;
  const toY = (db) => clamp(zero - (db / 24) * (h * 0.45), top, top + h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = GREY;
  line(ctx, 1, (i) => x0 + i * w, () => zero + 0.5);
  // The MG's sweep on each cutoff, drawn as a bracket around it.
  const sweep = (c, amt, col) => {
    const cx = x0 + clamp(c, 0, 1) * w;
    const half = clamp(amt, 0, 1) * w * 0.15;
    if (half < 1) return;
    ctx.strokeStyle = col;
    line(ctx, 1, (i) => cx - half + i * 2 * half, () => top + h - 2.5);
  };
  sweep(hc, p["HPF Modulation Amount"] ?? 0, ORANGE);
  sweep(lc, p["LPF Modulation Amount"] ?? 0, BLUE);
  ctx.strokeStyle = GREY;
  line(ctx, w, (i) => x0 + i, (i) => toY(response(i / Math.max(1, w), hc, hp, true, mk2)));
  line(ctx, w, (i) => x0 + i, (i) => toY(response(i / Math.max(1, w), lc, lp, false, mk2)));
  ctx.strokeStyle = WHITE;
  line(ctx, w, (i) => x0 + i, (i) => {
    const x = i / Math.max(1, w);
    return toY(response(x, hc, hp, true, mk2) + response(x, lc, lp, false, mk2));
  });
  ctx.fillStyle = ORANGE;
  ctx.fillRect(x0 + clamp(hc, 0, 1) * w - 2, top + h - 1, 4, 3);
  ctx.fillStyle = BLUE;
  ctx.fillRect(x0 + clamp(lc, 0, 1) * w - 2, top + h - 1, 4, 3);
  ctx.fillStyle = ORANGE;
  ctx.fillText("HPF", 4, 9);
  ctx.fillStyle = BLUE;
  ctx.fillText("LPF", 26, 9);
  ctx.fillStyle = GREY;
  ctx.textAlign = "right";
  ctx.fillText(mk2 ? "MKII" : "MKI", W - 4, 9);
  ctx.textAlign = "left";
}

function env_screen(lcd) {
  const { ctx, width: W, height: H, params: p } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const x0 = 4;
  const w = W - 8;
  const top = 14;
  const h = H - top - 4;
  const gate = 0.62;
  const seg = (v) => 0.02 + clamp(v, 0, 1) * 0.2;
  const draw = (pts, col) => {
    ctx.strokeStyle = col;
    line(ctx, pts.length - 1, (i) => x0 + clamp(pts[i][0], 0, 1) * w, (i) => top + h - pts[i][1] * h);
  };
  ctx.strokeStyle = GREY;
  ctx.setLineDash([2, 3]);
  line(ctx, 1, () => x0 + gate * w + 0.5, (i) => top + i * h);
  ctx.setLineDash([]);
  // EG1: delay, attack, held while the key is down, release.
  const d1 = seg(p["EG1 Delay Time"] ?? 0.1);
  const a1 = seg(p["EG1 Attack Time"] ?? 0);
  const r1 = seg(p["EG1 Release Time"] ?? 0.05);
  const e1 = d1 + a1 < gate ? 1 : clamp((gate - d1) / Math.max(1e-3, a1), 0, 1);
  draw([[0, 0], [Math.min(gate, d1), 0], [Math.min(gate, d1 + a1), e1], [gate, e1], [gate + r1, 0]], GREEN);
  // EG2: hold, attack, decay to sustain, release.
  const hold = seg(p["EG2 Hold Time"] ?? 0) - 0.02;
  const a2 = seg(p["EG2 Attack Time"] ?? 0);
  const d2 = seg(p["EG2 Decay Time"] ?? 0.1);
  const s2 = clamp(p["EG2 Sustain Level"] ?? 1, 0, 1);
  const r2 = seg(p["EG2 Release Time"] ?? 0.05);
  const pk = Math.min(gate, hold + a2);
  draw([[0, 0], [Math.min(gate, hold), 0], [pk, 1], [Math.min(gate, pk + d2), s2], [gate, s2], [gate + r2, 0]], WHITE);
  ctx.fillStyle = GREEN;
  ctx.fillText("EG1", 4, 9);
  ctx.fillStyle = WHITE;
  ctx.fillText("EG2", 26, 9);
}

// MS-20 MG: the waveform knob slides the peak of a triangle from ramp-down to ramp-up.
function mgShape(ph, skew) {
  const f = ph - Math.floor(ph);
  const k = clamp(skew, 0.02, 0.98);
  return f < k ? (f / k) * 2 - 1 : 1 - ((f - k) / (1 - k)) * 2;
}

function mg_screen(lcd) {
  const { ctx, width: W, height: H, params: p, now } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const skew = p["MG Waveform"] ?? 0.05;
  const freq = p["MG Frequency"] ?? 0.05;
  const cycles = 1 + freq * 6;
  const x0 = 4;
  const w = W - 8;
  const top = 14;
  const h = H - top - 6;
  const mid = top + h / 2;
  ctx.lineWidth = 1;
  ctx.strokeStyle = GREY;
  line(ctx, w, (i) => x0 + i, (i) => {
    const f = ((i / Math.max(1, w)) * cycles) % 1;
    return f < clamp(skew, 0.02, 0.98) ? mid - h * 0.42 : mid + h * 0.42;
  });
  ctx.strokeStyle = BLUE;
  line(ctx, w, (i) => x0 + i, (i) => mid - mgShape((i / Math.max(1, w)) * cycles, skew) * h * 0.42);
  // A dot riding the wave at the MG's own rate.
  const t = (((now ?? 0) / 1000) * (0.1 + freq * 2)) % 1;
  const dx = x0 + t * w;
  const dy = mid - mgShape(t * cycles, skew) * h * 0.42;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(dx, dy, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BLUE;
  ctx.fillText("MG", 4, 9);
  ctx.fillStyle = GREY;
  ctx.fillText("PULSE", 20, 9);
}

export default { filter_screen, env_screen, mg_screen };
