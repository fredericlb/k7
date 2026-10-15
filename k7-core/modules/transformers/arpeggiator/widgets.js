// Screen for the arpeggiator: the step grid Custom plays, with a preset pictured on the same grid.
// Columns are steps, rows are slots of the held chord — slot 1, the lowest note, at the bottom —
// stacking up through the octaves. Under each step, its velocity bar, then its gate bar.
// A preset depends on the chord, so it is pictured for a 4-note one. Editing a preset (a cell or a bar)
// turns it into Custom, starting from what was shown (engine docs/arpeggiator.md).

const MAX = 16;
const CHORD = 4;
const NAMES = ["UP", "DOWN", "UP-DOWN", "RANDOM", "CUSTOM"];
const CUSTOM = 4;
const HEAD = 11;
const STRIP = 7;
// One bar row's height, and the gap above it.
const BAR = 16;
const GAP = 3;
// What an untouched step carries, and the span a gate may take — the plugin's own numbers.
const VEL_DEFAULT = 1;
const GATE_DEFAULT = 0.5;
const GATE_MIN = 0.05;
const GATE_MAX = 0.95;
const FONT = "8px ui-monospace, monospace";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

// The default the engine gives an untouched step: `up` over eight slots.
const stepDefault = (i) => (i % 8) + 1;

function octavesOf(p) {
  return clamp(Math.round(p.Octaves ?? 1), 1, 4);
}

// Enough rows for the chord across its octaves, never fewer than eight so a drawing has room.
function rowsOf(p) {
  return Math.min(MAX, Math.max(8, CHORD * octavesOf(p)));
}

// The steps a preset walks for a CHORD-note chord, as the engine's noteFor walks them.
function presetSteps(dir, oct) {
  const count = CHORD * oct;
  const out = [];
  if (dir === 1) for (let i = 0; i < count; i++) out.push(count - i);
  else if (dir === 2) {
    const period = count > 1 ? 2 * count - 2 : 1;
    for (let j = 0; j < period; j++) out.push((j < count ? j : period - j) + 1);
  } else if (dir === 3) {
    // The engine's xorshift and seed, so the picture is one random walk it could play.
    let s = 0x9e3779b9 >>> 0;
    for (let i = 0; i < count; i++) {
      s = (s ^ (s << 13)) >>> 0;
      s = (s ^ (s >>> 17)) >>> 0;
      s = (s ^ (s << 5)) >>> 0;
      out.push((s % count) + 1);
    }
  } else for (let i = 0; i < count; i++) out.push(i + 1);
  return out.slice(0, MAX);
}

// What the grid shows: the drawn steps under Custom, else the preset's walk at the default levels.
function patternOf(p) {
  const dir = Math.round(p.Direction ?? 0);
  if (dir === CUSTOM) {
    const steps = [];
    const vel = [];
    const gate = [];
    for (let i = 0; i < MAX; i++) {
      steps.push(Math.round(p[`Step ${i + 1}`] ?? stepDefault(i)));
      vel.push(clamp(p[`Velocity ${i + 1}`] ?? VEL_DEFAULT, 0, 1));
      gate.push(clamp(p[`Gate ${i + 1}`] ?? GATE_DEFAULT, GATE_MIN, GATE_MAX));
    }
    return { dir, steps, vel, gate, length: clamp(Math.round(p.Steps ?? 8), 1, MAX) };
  }
  const walk = presetSteps(dir, octavesOf(p));
  const steps = [];
  for (let i = 0; i < MAX; i++) steps.push(walk[i] ?? 0);
  return {
    dir,
    steps,
    vel: Array(MAX).fill(VEL_DEFAULT),
    gate: Array(MAX).fill(GATE_DEFAULT),
    length: walk.length,
  };
}

// Where everything sits: a title line, the grid, the length strip, then the velocity and gate bars.
function layout(W, H, rows) {
  const x0 = 3;
  const y0 = HEAD;
  const cw = (W - 6) / MAX;
  const rh = (H - HEAD - STRIP - 2 * (BAR + GAP) - 3) / rows;
  const stripY = y0 + rows * rh + 2;
  const velY = stripY + STRIP + GAP;
  return { x0, y0, cw, rh, stripY, velY, gateY: velY + BAR + GAP };
}

// A bar's 0..1 fill for a value, and the value under a pointer height — the gate spans its own range.
const gateFill = (g) => (g - GATE_MIN) / (GATE_MAX - GATE_MIN);
const barValue = (top, y) => clamp(1 - (y - top) / BAR, 0, 1);

function drawBar(ctx, x, w, top, fill, lit, color) {
  ctx.strokeStyle = color.dim;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(top) + 0.5, Math.max(1, w - 1), BAR - 1);
  const h = Math.round((BAR - 2) * clamp(fill, 0, 1));
  if (h <= 0) return;
  ctx.fillStyle = lit;
  ctx.fillRect(Math.round(x) + 1, Math.round(top) + BAR - 1 - h, Math.max(1, w - 2), h);
}

function draw(lcd) {
  const { ctx, width: W, height: H, params: p, color } = lcd;
  if (W < 60 || H < 40) return;
  const rows = rowsOf(p);
  const g = layout(W, H, rows);
  const pat = patternOf(p);

  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = color.ink;
  ctx.textAlign = "left";
  ctx.fillText(NAMES[pat.dir] ?? "UP", 3, 1);
  ctx.fillStyle = color.dim;
  ctx.textAlign = "right";
  // While a bar is dragged, the right of the title says what it is set to.
  const e = lcd.state.edit;
  const shown =
    e && (e.mode === "velocity" || e.mode === "gate") && e.col != null
      ? `${e.col + 1}: ${e.mode === "velocity" ? "VEL" : "GATE"} ${Math.round((e.mode === "velocity" ? e.vel : e.gate)[e.col] * 100)}%`
      : pat.dir === CUSTOM
        ? `${pat.length} STEPS`
        : `AS FOR ${CHORD} NOTES`;
  ctx.fillText(shown, W - 3, 1);

  for (let c = 0; c < MAX; c++) {
    const x = g.x0 + c * g.cw;
    const live = c < pat.length;
    // The cell outlines: faint past the pattern's end, a bar line every four steps.
    ctx.strokeStyle = live ? color.dim : "rgba(184,240,160,0.08)";
    ctx.lineWidth = 1;
    for (let r = 0; r < rows; r++)
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(g.y0 + r * g.rh) + 0.5, Math.max(1, g.cw - 1), Math.max(1, g.rh - 1));
    if (c % 4 === 0) {
      ctx.fillStyle = color.dim;
      ctx.fillRect(Math.round(x), g.y0, 1, rows * g.rh);
    }
    const slot = pat.steps[c];
    if (live && slot > 0) {
      const r = rows - Math.min(slot, rows);
      ctx.fillStyle = pat.dir === CUSTOM ? color.glow : color.ink;
      ctx.fillRect(Math.round(x) + 1, Math.round(g.y0 + r * g.rh) + 1, Math.max(1, g.cw - 2), Math.max(1, g.rh - 2));
    }
    // The length strip: lit up to the last step, so dragging it reads as dragging the end.
    ctx.fillStyle = live ? color.ink : "rgba(184,240,160,0.12)";
    ctx.fillRect(Math.round(x) + 1, Math.round(g.stripY), Math.max(1, g.cw - 2), STRIP - 2);
    // Its velocity, then its gate — bright when drawn, dim on a preset, faint past the end.
    const lit = !live ? "rgba(184,240,160,0.12)" : pat.dir === CUSTOM ? color.glow : color.dim;
    drawBar(ctx, x, g.cw, g.velY, pat.vel[c], lit, color);
    drawBar(ctx, x, g.cw, g.gateY, gateFill(pat.gate[c]), lit, color);
  }
}

// The cell under the pointer, the strip, or a bar with the value at that height; null outside.
function hit(lcd, ev) {
  const rows = rowsOf(lcd.params);
  const g = layout(lcd.width, lcd.height, rows);
  const col = Math.floor((ev.x - g.x0) / g.cw);
  if (col < 0 || col >= MAX) return null;
  if (ev.y >= g.gateY - GAP / 2) return { col, bar: "gate", value: barValue(g.gateY, ev.y) };
  if (ev.y >= g.velY - GAP / 2) return { col, bar: "velocity", value: barValue(g.velY, ev.y) };
  if (ev.y >= g.stripY - 1) return { col, strip: true };
  const r = Math.floor((ev.y - g.y0) / g.rh);
  if (r < 0 || r >= rows) return null;
  return { col, slot: rows - r };
}

// The first edit of a gesture on a preset makes it Custom, holding what the screen was showing.
function begin(lcd) {
  const pat = patternOf(lcd.params);
  if (pat.dir !== CUSTOM) {
    lcd.set("Direction", CUSTOM);
    lcd.set("Steps", pat.length);
    for (let i = 0; i < MAX; i++) {
      lcd.set(`Step ${i + 1}`, pat.steps[i]);
      lcd.set(`Velocity ${i + 1}`, pat.vel[i]);
      lcd.set(`Gate ${i + 1}`, pat.gate[i]);
    }
  }
  lcd.state.edit = {
    steps: pat.steps.slice(),
    vel: pat.vel.slice(),
    gate: pat.gate.slice(),
    length: pat.length,
    mode: null,
    col: null,
  };
}

// A bar dragged: the step under the pointer takes the height, so a sweep across draws a curve.
function setLevel(lcd, at) {
  const e = lcd.state.edit;
  e.col = at.col;
  if (e.mode === "velocity") {
    const v = Math.round(at.value * 100) / 100;
    if (e.vel[at.col] !== v) {
      e.vel[at.col] = v;
      lcd.set(`Velocity ${at.col + 1}`, v);
    }
  } else {
    const v = Math.round((GATE_MIN + at.value * (GATE_MAX - GATE_MIN)) * 100) / 100;
    if (e.gate[at.col] !== v) {
      e.gate[at.col] = v;
      lcd.set(`Gate ${at.col + 1}`, v);
    }
  }
}

function setStep(lcd, col, value) {
  const e = lcd.state.edit;
  if (e.steps[col] !== value) {
    e.steps[col] = value;
    lcd.set(`Step ${col + 1}`, value);
  }
  // Drawing past the end lengthens the pattern to reach it.
  if (value > 0 && col + 1 > e.length) setLength(lcd, col + 1);
}

function setLength(lcd, length) {
  const e = lcd.state.edit;
  if (e.length === length) return;
  e.length = length;
  lcd.set("Steps", length);
}

function pointer(lcd, ev) {
  if (ev.type === "up") {
    lcd.state.edit = null;
    return true;
  }
  const at = hit(lcd, ev);
  if (ev.type === "down") {
    if (!at) return true;
    begin(lcd);
    const e = lcd.state.edit;
    // A press on a lit cell erases along the drag; anywhere else it paints that row. A bar sets levels.
    e.mode = at.bar ?? (at.strip ? "length" : e.steps[at.col] === at.slot ? "erase" : "paint");
  }
  const e = lcd.state.edit;
  if (!e || !at) return true;
  if (e.mode === "velocity" || e.mode === "gate") {
    // Off the bars, the pointer still steers the column; its height clamps to the bar's ends.
    const g = layout(lcd.width, lcd.height, rowsOf(lcd.params));
    const top = e.mode === "velocity" ? g.velY : g.gateY;
    setLevel(lcd, { col: at.col, value: barValue(top, ev.y) });
  } else if (e.mode === "length") setLength(lcd, at.col + 1);
  else if (!at.strip && !at.bar) setStep(lcd, at.col, e.mode === "erase" ? 0 : at.slot);
  return true;
}

export default {
  pattern: { draw, pointer },
};
