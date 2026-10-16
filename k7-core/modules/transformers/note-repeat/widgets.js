// Screen for the note repeater: the rhythm as spokes round a centre, one per step of the cycle,
// step 1 at twelve o'clock. A hit is a long spoke, an accented one the brightest; a rest is short.
// Drag up/down for the density, left/right to rotate it, shift-drag left/right for its length.
// The maths is the engine's (engine/k7-runtime/engine/NoteSteps.h), so the picture is what plays.

const MODES = ["EVERY STEP", "BURST", "EUCLID"];
const EUCLID = 2;
const FONT = "8px ui-monospace, monospace";
// Pixels of drag for the whole 0..1 range of density or rotate.
const DRAG_SPAN = 120;
// Pixels of shift-drag per step of length.
const STEP_PX = 8;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

// The rule as the params set it, read the way the engine reads its inputs.
function ruleOf(p) {
  const mode = Math.round(clamp(p.Pattern ?? 0, 0, 2));
  const n = Math.round(clamp(p.Length ?? 16, 1, 32));
  const share = (s, of) => clamp(Math.round(clamp(s, 0, 1) * of), 0, of);
  return {
    mode,
    n,
    k: mode === 0 ? n : share(p.Density ?? 0.5, n),
    r: Math.round(clamp(p.Rotate ?? 0, 0, 1) * n) % n,
    accents: clamp(p.Accents ?? 1, 0, 1),
    low: clamp(p.Low ?? 0.5, 0, 1),
    opposite: (p.Opposite ?? 0) >= 0.5,
    keep: (p.Keep ?? 0) >= 0.5,
    chance: clamp(p.Chance ?? 1, 0, 1),
    share,
  };
}

function euclid(i, k, n) {
  if (k <= 0 || n <= 0) return false;
  if (k >= n) return true;
  return (i * k) % n < k;
}

const turned = (s, i) => (((i % s.n) + s.n - s.r) % s.n);

function hit(s, i) {
  if (s.mode === 1) return turned(s, i) < s.k;
  if (s.mode === EUCLID) return euclid(turned(s, i), s.k, s.n);
  return true;
}

function accented(s, i) {
  let on;
  if (s.keep) on = euclid(turned(s, i), s.share(s.accents, s.n), s.n);
  else {
    let j = 0;
    for (let t = 0; t < i; t++) if (hit(s, t)) j++;
    on = s.k > 0 && euclid(j, s.share(s.accents, s.k), s.k);
  }
  return on !== s.opposite;
}

function draw(lcd) {
  const { ctx, width: W, height: H, params: p, color } = lcd;
  if (W < 50 || H < 40) return;
  const s = ruleOf(p);
  const cx = W / 2;
  const cy = H / 2 + 4;
  const R = Math.min(W / 2, H / 2 - 6) - 6;

  ctx.lineCap = "round";
  for (let i = 0; i < s.n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / s.n;
    const on = hit(s, i);
    const acc = on && accented(s, i);
    // A spoke's length is its loudness: an accent full, a plain hit at the low level, a rest short.
    const len = on ? R * (acc ? 1 : 0.35 + 0.65 * s.low) : R * 0.45;
    ctx.strokeStyle = on ? (acc ? color.glow : color.ink) : color.dim;
    ctx.lineWidth = on ? 2 : 1;
    // A chance under one fades every hit by it: the spoke plays that often.
    ctx.globalAlpha = on ? 0.35 + 0.65 * s.chance : 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = color.ink;
  ctx.textAlign = "left";
  ctx.fillText(MODES[s.mode], 3, 2);
  ctx.textAlign = "right";
  ctx.fillText(`${s.k} / ${s.n}`, W - 3, 2);
  ctx.fillStyle = color.dim;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  if (s.r) ctx.fillText(`ROT ${s.r}`, 3, H - 2);
  ctx.textAlign = "right";
  if (s.chance < 1) ctx.fillText(`${Math.round(s.chance * 100)}%`, W - 3, H - 2);
}

function pointer(lcd, ev) {
  const p = lcd.params;
  if (ev.type === "up") {
    lcd.state.drag = null;
    return true;
  }
  if (ev.type === "down" && ev.shift) {
    // Shift: the drag is the LENGTH, left shorter and right longer, and nothing else moves.
    lcd.state.drag = { x: ev.x, length: Math.round(clamp(p.Length ?? 16, 1, 32)) };
    return true;
  }
  if (ev.type === "down") {
    // Every step has no density to drag: the first gesture makes it a Euclid, from where it was.
    if (Math.round(p.Pattern ?? 0) === 0) lcd.set("Pattern", EUCLID);
    lcd.state.drag = {
      x: ev.x,
      y: ev.y,
      density: clamp(p.Density ?? 0.5, 0, 1),
      rotate: clamp(p.Rotate ?? 0, 0, 1),
    };
    return true;
  }
  const d = lcd.state.drag;
  if (!d) return true;
  if (d.length !== undefined) {
    const next = clamp(d.length + Math.round((ev.x - d.x) / STEP_PX), 1, 32);
    if (next !== Math.round(p.Length ?? 16)) lcd.set("Length", next);
    return true;
  }
  const density = clamp(d.density + (d.y - ev.y) / DRAG_SPAN, 0, 1);
  // Rotate wraps rather than stops: a turn past the last step is the first one again.
  const rotate = (((d.rotate + (ev.x - d.x) / DRAG_SPAN) % 1) + 1) % 1;
  lcd.set("Density", Math.round(density * 100) / 100);
  lcd.set("Rotate", Math.round(rotate * 100) / 100);
  return true;
}

export default {
  rhythm: { draw, pointer },
};
