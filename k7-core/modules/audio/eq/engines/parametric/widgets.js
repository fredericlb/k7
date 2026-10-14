// Parametric EQ — the five bands' summed response over the signal in and out, and the bands' points to drag.
// Interactive: drag a point for frequency and gain (shift is fine), alt-drag it up/down for Q, alt-click resets its gain.

const FONT = "8px ui-monospace, monospace";
const GREY = "#6b6b6b";
const WHITE = "#ffffff";
const F_LO = 20;
const F_HI = 20000;
const DB = 18;
const SR = 48000;
const HIT_PX = 14;
// Pixels of alt-drag that double a band's Q.
const Q_PX = 70;

// Name, filter, frequency range and default, Q range and default, colour — jsdsp.ts keeps the same table.
const BANDS = [
  ["Low", "lowshelf", 20, 1000, 100, 0.3, 2, 0.707, "#ff6a1a"],
  ["Low Mid", "peak", 40, 4000, 300, 0.1, 10, 1, "#ffc93d"],
  ["Mid", "peak", 200, 8000, 1000, 0.1, 10, 1, "#3ec96b"],
  ["High Mid", "peak", 800, 16000, 3500, 0.1, 10, 1, "#3d7dff"],
  ["High", "highshelf", 1000, 20000, 8000, 0.3, 2, 0.707, "#b35cff"],
];

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)}K` : `${Math.round(f)}`);

// Each band as it is set now, missing params falling back to the defaults.
function bandsOf(params) {
  return BANDS.map(([name, mode, fLo, fHi, fDef, qLo, qHi, qDef, color]) => ({
    name,
    mode,
    fLo,
    fHi,
    qLo,
    qHi,
    color,
    f: clamp(num(params[`${name} Freq`], fDef), fLo, fHi),
    g: clamp(num(params[`${name} Gain`], 0), -DB, DB),
    q: clamp(num(params[`${name} Q`], qDef), qLo, qHi),
  }));
}

// The engine's own coefficients (JUCE's IIRCoefficients), as [b0, b1, b2, a0, a1, a2].
function coeffs(band) {
  const A = Math.sqrt(10 ** (band.g / 20));
  const w = (2 * Math.PI * clamp(band.f, 20, SR * 0.45)) / SR;
  const c = Math.cos(w);
  const s = Math.sin(w);
  if (band.mode === "peak") {
    const al = s / (2 * band.q);
    return [1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A];
  }
  const be = (s * Math.sqrt(A)) / band.q;
  const am = A - 1;
  const ap = A + 1;
  if (band.mode === "lowshelf")
    return [A * (ap - am * c + be), 2 * A * (am - ap * c), A * (ap - am * c - be), ap + am * c + be, -2 * (am + ap * c), ap + am * c - be];
  return [A * (ap + am * c + be), -2 * A * (am + ap * c), A * (ap + am * c - be), ap - am * c + be, 2 * (am - ap * c), ap - am * c - be];
}

// dB of one biquad at frequency f, from |H(e^jw)|.
function dbAt(k, f) {
  const w = (2 * Math.PI * f) / SR;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = k[0] + k[1] * c1 + k[2] * c2;
  const ni = k[1] * s1 + k[2] * s2;
  const dr = k[3] + k[4] * c1 + k[5] * c2;
  const di = k[4] * s1 + k[5] * s2;
  return 10 * Math.log10(Math.max(1e-30, nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di));
}

const frame = (W, H) => ({ x: 4, y: 13, w: Math.max(1, W - 8), h: Math.max(1, H - 17) });
const xOf = (b, f) => b.x + (Math.log(clamp(f, F_LO, F_HI) / F_LO) / Math.log(F_HI / F_LO)) * b.w;
const fOf = (b, px) => F_LO * (F_HI / F_LO) ** ((px - b.x) / Math.max(1, b.w));
const yOf = (b, db) => b.y + (1 - (clamp(db, -DB, DB) + DB) / (2 * DB)) * b.h;
const dbOf = (b, py) => DB - ((py - b.y) / Math.max(1, b.h)) * 2 * DB;

// The band whose point is nearest (x, y), within `reach` pixels, else -1.
function nearest(b, bands, x, y, reach) {
  let best = -1;
  let bestD = reach;
  bands.forEach((band, i) => {
    const d = Math.hypot(xOf(b, band.f) - x, yOf(b, band.g) - y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

// The signal as a mirrored envelope, newest at the right edge, one history point per pixel.
function envelope(ctx, b, points, fill) {
  const n = Math.min(points.length, Math.floor(b.w));
  if (n < 2) return;
  const mid = b.y + b.h / 2;
  const half = b.h / 2;
  const hOf = (p) => clamp((20 * Math.log10(Math.max(1e-6, p)) + 48) / 48, 0, 1) * half;
  const x0 = b.x + b.w - n;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x0, mid);
  for (let i = 0; i < n; i++) ctx.lineTo(x0 + i, mid - hOf(points[points.length - n + i]));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(x0 + i, mid + hOf(points[points.length - n + i]));
  ctx.closePath();
  ctx.fill();
}

function grid(ctx, b) {
  ctx.strokeStyle = "#222";
  ctx.beginPath();
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = Math.round(xOf(b, f)) + 0.5;
    ctx.moveTo(x, b.y);
    ctx.lineTo(x, b.y + b.h);
  }
  for (const db of [-12, -6, 6, 12]) {
    const y = Math.round(yOf(b, db)) + 0.5;
    ctx.moveTo(b.x, y);
    ctx.lineTo(b.x + b.w, y);
  }
  ctx.stroke();
  ctx.strokeStyle = GREY;
  ctx.beginPath();
  const y0 = Math.round(yOf(b, 0)) + 0.5;
  ctx.moveTo(b.x, y0);
  ctx.lineTo(b.x + b.w, y0);
  ctx.stroke();
}

function curve(ctx, b, dbFn, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let px = b.x; px <= b.x + b.w; px++) {
    const y = yOf(b, dbFn(fOf(b, px)));
    if (px === b.x) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}

function text(ctx, s, x, y, color, align) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

export default {
  eq: {
    draw(lcd) {
      const { ctx, width: W, height: H, params, state } = lcd;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.font = FONT;
      ctx.lineWidth = 1;
      const b = frame(W, H);
      const bands = bandsOf(params);
      const ks = bands.map(coeffs);
      const sel = typeof state.sel === "number" && bands[state.sel] ? state.sel : -1;

      envelope(ctx, b, lcd.input, "rgba(255,255,255,0.10)");
      envelope(ctx, b, lcd.output, "rgba(62,201,107,0.22)");
      grid(ctx, b);
      if (sel >= 0) {
        ctx.globalAlpha = 0.6;
        curve(ctx, b, (f) => dbAt(ks[sel], f), bands[sel].color, 1);
        ctx.globalAlpha = 1;
      }
      curve(ctx, b, (f) => ks.reduce((sum, k) => sum + dbAt(k, f), 0), WHITE, 1.5);

      bands.forEach((band, i) => {
        const x = xOf(b, band.f);
        const y = yOf(b, band.g);
        ctx.fillStyle = band.color;
        ctx.beginPath();
        ctx.arc(x, y, i === sel ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        if (i === sel) {
          ctx.strokeStyle = WHITE;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      if (sel >= 0) {
        const band = bands[sel];
        const g = `${band.g > 0 ? "+" : ""}${band.g.toFixed(1)} DB`;
        text(ctx, band.name.toUpperCase(), b.x, 9, band.color, "left");
        text(ctx, `${hz(band.f)} HZ  ${g}  Q ${band.q.toFixed(2)}`, W - 4, 9, WHITE, "right");
      } else {
        text(ctx, "PARAMETRIC EQ", b.x, 9, WHITE, "left");
        text(ctx, "DRAG A POINT", W - 4, 9, GREY, "right");
      }
    },

    pointer(lcd, ev) {
      const { width: W, height: H, params, state } = lcd;
      const b = frame(W, H);
      const bands = bandsOf(params);
      if (ev.type === "down") {
        const i = nearest(b, bands, ev.x, ev.y, HIT_PX);
        state.sel = i;
        state.drag = null;
        if (i < 0) return false;
        // Alt: a drag is the Q, and a click that never moves resets the gain — decided on release.
        if (ev.alt) {
          state.drag = { q: true, y0: ev.y, q0: bands[i].q, moved: false };
          return true;
        }
        state.drag = { x0: ev.x, y0: ev.y, px: xOf(b, bands[i].f), py: yOf(b, bands[i].g) };
        return true;
      }
      if (ev.type === "move") {
        const d = state.drag;
        const band = bands[state.sel];
        if (!d || !band) return false;
        const fine = ev.shift ? 0.25 : 1;
        if (d.q) {
          // Up narrows it: a doubling of Q every 70 px, a quarter of that with shift.
          const q = clamp(d.q0 * Math.pow(2, ((d.y0 - ev.y) * fine) / Q_PX), band.qLo, band.qHi);
          d.moved = d.moved || Math.abs(ev.y - d.y0) > 2;
          lcd.set(`${band.name} Q`, Math.round(q * 100) / 100);
          return true;
        }
        const f = clamp(fOf(b, d.px + (ev.x - d.x0) * fine), band.fLo, band.fHi);
        const g = clamp(dbOf(b, d.py + (ev.y - d.y0) * fine), -DB, DB);
        lcd.set(`${band.name} Freq`, Number(f.toPrecision(4)));
        lcd.set(`${band.name} Gain`, Math.round(g * 10) / 10);
        return true;
      }
      // Up: an alt-click that never moved resets the gain.
      const d = state.drag;
      const band = bands[state.sel];
      if (d && d.q && !d.moved && band) lcd.set(`${band.name} Gain`, 0);
      state.drag = null;
      return true;
    },
  },
};
