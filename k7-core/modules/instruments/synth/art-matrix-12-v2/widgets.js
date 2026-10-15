// Screens for Matrix-12 V2: oscillators, filter response, the five envelopes, LFO1/2 and the FX1 slot.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const num = (p, k, d) => (typeof p[k] === "number" && isFinite(p[k]) ? p[k] : d);
const on = (p, k, d) => num(p, k, d) >= 0.5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.lineWidth = 1;
}

function text(ctx, s, x, y, c, align) {
  ctx.fillStyle = c;
  ctx.textAlign = align || "left";
  ctx.fillText(s, x, y);
}

function path(ctx, pts, c) {
  if (pts.length < 2) return;
  ctx.strokeStyle = c;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

// One cycle of a Matrix oscillator: the enabled waves summed, t in 0..1.
function oscSample(t, saw, pulse, tri, pw) {
  let v = 0, n = 0;
  if (saw) { v += 1 - 2 * t; n++; }
  if (pulse) { v += t < pw ? 1 : -1; n++; }
  if (tri) { v += t < 0.5 ? 4 * t - 1 : 3 - 4 * t; n++; }
  return n ? v / n : 0;
}

function lfoSample(t, wave, seed) {
  const f = t - Math.floor(t);
  const step = Math.floor(t);
  const rnd = (k) => { const x = Math.sin((k + seed) * 12.9898) * 43758.5453; return 2 * (x - Math.floor(x)) - 1; };
  switch (wave) {
    case 1: return f < 0.5 ? 1 : -1;
    case 2: return 2 * f - 1;
    case 3: return 1 - 2 * f;
    case 4: return rnd(step);
    case 5: return rnd(Math.floor(t * 24));
    case 6: return rnd(step * 3 + 1);
    default: return f < 0.5 ? 4 * f - 1 : 3 - 4 * f;
  }
}

const LFO_NAMES = ["TRI", "SQR", "SAW+", "SAW-", "RND", "NOISE", "S&H"];
const FILTER_NAMES = ["LP1", "LP2", "LP3", "LP4", "HP1", "HP2", "HP3", "BP2", "BP4", "NOTCH", "PHASE", "HP2+LP", "HP3+LP", "NT+LP", "PH+LP"];
const FX_NAMES = ["NONE", "DELAY", "PHASER", "ANALOG DLY", "FLANGER", "CHORUS", "REVERB"];

// Magnitude of the Matrix filter mode at ratio r = f / fc.
function filterMag(mode, r, q) {
  const lp = (n) => 1 / Math.pow(1 + r * r, n / 2);
  const hp = (n) => 1 / Math.pow(1 + 1 / (r * r), n / 2);
  const bp = (k) => 1 / Math.sqrt(1 + Math.pow(k * (r - 1 / r), 2));
  const notch = () => { const a = 1 - r * r; return Math.abs(a) / Math.sqrt(a * a + r * r) ; };
  let m;
  switch (mode) {
    case 0: case 1: case 2: case 3: m = lp(mode + 1); break;
    case 4: case 5: case 6: m = hp(mode - 3); break;
    case 7: m = bp(1); break;
    case 8: m = bp(1) * bp(1); break;
    case 9: m = notch(); break;
    case 10: m = 1; break;
    case 11: m = hp(2) * lp(1); break;
    case 12: m = hp(3) * lp(1); break;
    case 13: m = notch() * lp(1); break;
    default: m = lp(1);
  }
  const lr = Math.log2(Math.max(r, 1e-6));
  return m * (1 + q * 6 / (1 + lr * lr * 40));
}

function envPoints(p, n, x0, x1, y0, y1) {
  const dl = num(p, `Env${n} Delay`, 0), a = num(p, `Env${n} Attack`, 0), d = num(p, `Env${n} Decay`, 0);
  const s = num(p, `Env${n} Sustain`, 1), r = num(p, `Env${n} Release`, 0), amp = num(p, `Env${n} Amp`, 1);
  const hold = 0.6;
  const total = dl + a + d + hold + r + 0.01;
  const sx = (x1 - x0) / Math.max(total, 4);
  const yv = (v) => y1 - v * amp * (y1 - y0);
  let x = x0;
  const pts = [[x, yv(0)]];
  x += dl * sx; pts.push([x, yv(0)]);
  x += a * sx; pts.push([x, yv(1)]);
  x += d * sx; pts.push([x, yv(s)]);
  x += hold * sx; pts.push([x, yv(s)]);
  x += r * sx; pts.push([x, yv(0)]);
  return pts;
}

export default {
  osc_screen(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    glass(ctx, W, H);
    if (W < 20 || H < 20) return;
    const half = (H - 4) / 2;
    const rows = [
      { n: 1, c: BLUE, y: 2, extra: on(p, "Osc1 Noise", 0) ? "NOISE" : "" },
      { n: 2, c: GREEN, y: 2 + half, extra: on(p, "Osc2 Sync", 0) ? "SYNC" : "" },
    ];
    for (const o of rows) {
      const saw = on(p, `Osc${o.n} Saw`, 1), pulse = on(p, `Osc${o.n} Pulse`, 0), tri = on(p, `Osc${o.n} Tri`, 0);
      const pw = clamp(num(p, `Osc${o.n} PW`, 0.5), 0.02, 0.98);
      const vol = num(p, `Osc${o.n} Volume`, 1);
      const freq = Math.round(num(p, `Osc${o.n} Freq`, 0.4) * 63);
      const mid = o.y + half / 2 + 4, amp = (half / 2 - 7) * vol;
      ctx.strokeStyle = GREY;
      ctx.beginPath(); ctx.moveTo(4, mid); ctx.lineTo(W - 4, mid); ctx.stroke();
      const pts = [];
      const N = Math.max(2, Math.floor(W - 8));
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * 2;
        pts.push([4 + i, mid - amp * oscSample(t - Math.floor(t), saw, pulse, tri, pw)]);
      }
      path(ctx, pts, (saw || pulse || tri) && vol > 0.001 ? o.c : GREY);
      text(ctx, `OSC${o.n} ${freq}`, 4, o.y, WHITE);
      if (o.extra) text(ctx, o.extra, W - 4, o.y, ORANGE, "right");
    }
  },

  filt_screen(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    glass(ctx, W, H);
    if (W < 20 || H < 20) return;
    const mode = clamp(Math.round(num(p, "Filter Mode", 0.21) * 14), 0, 14);
    const fc = clamp(num(p, "Filter Freq", 0.38), 0, 1);
    const q = clamp(num(p, "Filter Res", 0), 0, 1);
    const top = 12, bot = H - 4, left = 4, right = W - 4;
    const dbTop = 18, dbBot = -48;
    const yOf = (db) => top + ((dbTop - clamp(db, dbBot, dbTop)) / (dbTop - dbBot)) * (bot - top);
    ctx.strokeStyle = GREY;
    ctx.beginPath(); ctx.moveTo(left, yOf(0)); ctx.lineTo(right, yOf(0)); ctx.stroke();
    const cx = left + fc * (right - left);
    const pts = [];
    for (let x = left; x <= right; x++) {
      const r = Math.pow(2, ((x - cx) / (right - left)) * 10);
      pts.push([x, yOf(20 * Math.log10(Math.max(filterMag(mode, r, q), 1e-4)))]);
    }
    path(ctx, pts, WHITE);
    const peak = pts[Math.round(clamp(cx - left, 0, pts.length - 1))];
    if (peak) { ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(cx, peak[1], 3, 0, Math.PI * 2); ctx.fill(); }
    text(ctx, FILTER_NAMES[mode] || "", left, 2, ORANGE);
    text(ctx, `RES ${Math.round(q * 100)}`, right, 2, WHITE, "right");
  },

  env_screen(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    glass(ctx, W, H);
    if (W < 40 || H < 20) return;
    const colors = [ORANGE, GREEN, BLUE, WHITE, GREY];
    for (let n = 5; n >= 1; n--) path(ctx, envPoints(p, n, 4, W - 4, 14, H - 4), colors[n - 1]);
    for (let n = 1; n <= 5; n++) text(ctx, `E${n}`, 4 + (n - 1) * 18, 2, colors[n - 1]);
  },

  lfo_screen(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    glass(ctx, W, H);
    if (W < 20 || H < 20) return;
    const half = (H - 4) / 2;
    for (const [n, c] of [[1, BLUE], [2, GREEN]]) {
      const y0 = 2 + (n - 1) * half;
      const wave = clamp(Math.round(num(p, `LFO${n} Wave`, 0) * 6), 0, 6);
      const sync = on(p, `LFO${n} Sync`, 0);
      const speed = num(p, `LFO${n} Speed`, 0.5);
      const amp = num(p, `LFO${n} Amp`, 1);
      const cycles = sync ? 1 + Math.round(num(p, `LFO${n} SyncedSpeed`, 0.4) * 12) / 3 : 0.5 + speed * 5;
      const mid = y0 + half / 2 + 4, a = (half / 2 - 7) * amp;
      ctx.strokeStyle = GREY;
      ctx.beginPath(); ctx.moveTo(4, mid); ctx.lineTo(W - 4, mid); ctx.stroke();
      const pts = [];
      const N = Math.max(2, Math.floor(W - 8));
      for (let i = 0; i <= N; i++) pts.push([4 + i, mid - a * lfoSample((i / N) * cycles, wave, n)]);
      path(ctx, pts, c);
      text(ctx, `LFO${n} ${LFO_NAMES[wave]}`, 4, y0, WHITE);
      if (sync) text(ctx, "SYNC", W - 4, y0, ORANGE, "right");
    }
  },

  fx_screen(lcd) {
    const { ctx, width: W, height: H, params: p } = lcd;
    glass(ctx, W, H);
    if (W < 40 || H < 20) return;
    const type = clamp(Math.round(num(p, "FX1 Selector", 0) * 6), 0, 6);
    const active = on(p, "FX1 Active", 0);
    text(ctx, `FX1 ${FX_NAMES[type]}`, 4, 2, active ? WHITE : GREY);
    if (!active) text(ctx, "OFF", W - 4, 2, RED, "right");
    const left = 6, right = W - 6, top = 16, bot = H - 4, h = bot - top;
    ctx.strokeStyle = GREY;
    ctx.beginPath(); ctx.moveTo(left, bot); ctx.lineTo(right, bot); ctx.stroke();
    const tap = (x, lvl, c) => { if (x > right || lvl < 0.02) return; ctx.fillStyle = c; ctx.fillRect(x - 1, bot - lvl * h, 3, lvl * h); };
    if (type === 1 || type === 3) {
      const t1 = type === 1 ? num(p, "FX1 Delay time ch1", 0.6) : num(p, "FX1 DubDelay delay time", 0.5);
      const t2 = type === 1 ? num(p, "FX1 Delay time ch2", 0.62) : t1;
      const fb1 = type === 1 ? num(p, "FX1 Delay feedback ch1", 0.24) : num(p, "FX1 DubDelay feedback", 0.47);
      const fb2 = type === 1 ? num(p, "FX1 Delay feedback ch2", 0.3) : fb1;
      const span = right - left;
      tap(left, 1, WHITE);
      for (const [t, fb, c, dx] of [[t1, fb1, BLUE, -2], [t2, fb2, GREEN, 2]]) {
        const step = Math.max(4, (0.08 + t * 0.4) * span);
        let lvl = 0.8;
        for (let i = 1; i < 40 && lvl > 0.02; i++) { tap(left + i * step + dx, lvl, c); lvl *= fb; }
      }
    } else if (type === 6) {
      const pre = num(p, "FX1 Reverb predelay time", 0.07), decay = num(p, "FX1 Reverb decay", 0.5);
      const damp = num(p, "FX1 Reverb damping", 0.5);
      const x0 = left + pre * (right - left) * 0.4;
      tap(left, 1, WHITE);
      const k = 1 / (0.05 + decay * 0.6);
      const pts = [];
      for (let x = x0; x <= right; x++) pts.push([x, bot - 0.8 * h * Math.exp(-k * ((x - x0) / (right - left)) * 3)]);
      path(ctx, pts, BLUE);
      const pts2 = [];
      for (let x = x0; x <= right; x++) pts2.push([x, bot - 0.8 * h * Math.exp(-k * (1 + damp * 2) * ((x - x0) / (right - left)) * 3)]);
      path(ctx, pts2, ORANGE);
    } else if (type === 2 || type === 4 || type === 5) {
      const rate = type === 2 ? num(p, "FX1 Phaser Rate Stage 1", 0.5) : type === 4 ? num(p, "FX1 Flanger rate", 0.5) : num(p, "FX1 Chorus LfoRate", 0.5);
      const depth = type === 2 ? num(p, "FX1 Phaser Depth Stage 1", 0.77) : type === 4 ? num(p, "FX1 Flanger depth", 0.54) : num(p, "FX1 Chorus Amount", 0.45);
      const cycles = 0.5 + rate * 4, mid = top + h / 2;
      const pts = [];
      for (let x = left; x <= right; x++) pts.push([x, mid - (h / 2 - 2) * depth * Math.sin(((x - left) / (right - left)) * cycles * Math.PI * 2)]);
      path(ctx, pts, type === 2 ? BLUE : type === 4 ? GREEN : WHITE);
    } else {
      ctx.strokeStyle = GREY;
      ctx.beginPath(); ctx.moveTo(left, top + h / 2); ctx.lineTo(right, top + h / 2); ctx.stroke();
    }
  },
};
