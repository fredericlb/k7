// RollGrid.ts — the PIANO-ROLL view of a sequence's notes: time left-to-right, one lane per
// semitone, positioned in PERCENTAGES so it stretches with the pane rather than scrolling a
// fixed grid. Click an empty cell to add a note, a note to remove it.
// See docs/noteGrids.md; TrackerGrid.ts is the other view.

import type { Note, RackInfo } from "./notes";

const GRID = 0.25; // step = a sixteenth, in beats
const BEATS_PER_BAR = 4; // the roll's gridlines/ruler assume 4/4, as before
const GUTTER_W = 54; // px, the note-name (piano-key) column + its MIDI number
const RULER_H = 16; // px, the bar-number row

// Is `key` a black key? (for lane / gutter shading)
const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(((k % 12) + 12) % 12);
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const label = (k: number) =>
  `${NOTE_NAMES[((k % 12) + 12) % 12]}${Math.floor(k / 12) - 1}`;

// Build the grid DOM; `onChange` fires with the full next note list. The element owns its own listeners.
export function renderRollGrid(
  notes: Note[],
  onChange: (next: Note[]) => void,
  // With a rack, each bar is captioned with its symbol and the gutter shows symbols instead of note names.
  rack: RackInfo | null = null,
  // The file's `from`/`to`, in beats — the span that PLAYS. Null when the file states none.
  win: { from: number; to: number } | null = null,
): HTMLElement {
  const keys = notes.map((n) => n.k);
  const hi = Math.min(127, (keys.length ? Math.max(...keys) : 72) + 3);
  const lo = Math.max(0, (keys.length ? Math.min(...keys) : 60) - 3);
  // The window joins the content span: a `to` reaching PAST the last hit is a pad, and a grid that
  // stopped at the notes would clip the very edge explaining the silence after them.
  const endBeat = Math.max(
    notes.reduce((m, n) => Math.max(m, n.t + n.d), BEATS_PER_BAR),
    win?.to ?? 0,
  );
  const totalBeats = Math.ceil(endBeat / BEATS_PER_BAR) * BEATS_PER_BAR; // whole bars
  const bars = totalBeats / BEATS_PER_BAR;
  const steps = Math.round(totalBeats / GRID);
  const rows = hi - lo + 1;

  const stepsPerBeat = Math.round(1 / GRID); // 4
  const stepsPerBar = Math.round(BEATS_PER_BAR / GRID); // 16
  const pctX = (beat: number) => (beat / totalBeats) * 100;
  const rowTop = (k: number) => ((hi - k) / rows) * 100;
  const rowH = (1 / rows) * 100;

  // Outer 2×2 grid: corner + ruler over gutter + body. The body's row/column are 1fr, so labels line up with it.
  const root = document.createElement("div");
  root.className = "td-roll";
  root.style.cssText = `position:relative;height:100%;width:100%;display:grid;grid-template-columns:${GUTTER_W}px 1fr;grid-template-rows:${RULER_H}px 1fr;background:var(--sh-background,#111);font-size:10px;color:var(--sh-muted-foreground,#888);overflow:hidden`;

  const corner = document.createElement("div");
  corner.style.cssText =
    "border-right:1px solid var(--sh-border,#333);border-bottom:1px solid var(--sh-border,#333)";
  root.appendChild(corner);

  // Top ruler — bar numbers, one per bar across the time axis.
  const ruler = document.createElement("div");
  ruler.style.cssText =
    "position:relative;border-bottom:1px solid var(--sh-border,#333);overflow:hidden";
  for (let b = 0; b < bars; b++) {
    const lab = document.createElement("div");
    lab.textContent = String(b + 1);
    lab.style.cssText = `position:absolute;top:0;bottom:0;left:${pctX(b * BEATS_PER_BAR)}%;padding-left:3px;display:flex;align-items:center;border-left:1px solid rgba(255,255,255,0.18);color:var(--sh-foreground,#ddd)`;
    ruler.appendChild(lab);
  }
  root.appendChild(ruler);

  // Left gutter: the name or symbol per pitch lane, C rows brighter and black keys shaded, mirroring the body.
  const gutter = document.createElement("div");
  gutter.style.cssText =
    "position:relative;border-right:1px solid var(--sh-border,#333);overflow:hidden";
  for (let r = 0; r < rows; r++) {
    const k = hi - r;
    const key = document.createElement("div");
    key.style.cssText = `position:absolute;left:0;right:0;top:${rowTop(k)}%;height:${rowH}%;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-end;gap:3px;padding-right:4px;font-size:9px;line-height:1;overflow:hidden;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,0.04);background:${isBlack(k) ? "rgba(255,255,255,0.04)" : "transparent"};color:${k % 12 === 0 ? "var(--sh-foreground,#ddd)" : "var(--sh-muted-foreground,#888)"}`;
    const sym = rack?.toSymbol.get(k);
    if (sym) {
      key.textContent = sym;
    } else {
      // The note name, then its raw MIDI number as a dim annotation next to it.
      const nm = document.createElement("span");
      nm.textContent = label(k);
      const num = document.createElement("span");
      num.textContent = String(k);
      num.style.cssText = "opacity:0.45";
      key.append(nm, num);
    }
    gutter.appendChild(key);
  }
  root.appendChild(gutter);

  // The note body — fills the remaining cell; everything inside is percentage-positioned.
  const body = document.createElement("div");
  body.style.cssText = "position:relative;overflow:hidden";
  root.appendChild(body);

  for (let r = 0; r < rows; r++) {
    const k = hi - r;
    const lane = document.createElement("div");
    lane.style.cssText = `position:absolute;left:0;right:0;top:${rowTop(k)}%;height:${rowH}%;box-sizing:border-box;border-bottom:1px solid rgba(255,255,255,0.04);background:${isBlack(k) ? "rgba(255,255,255,0.03)" : "transparent"}`;
    body.appendChild(lane);
  }
  // The window, as GROUND — appended after the lanes and before the gridlines and notes, so DOM
  // order alone puts it behind them (everything in here is absolutely positioned, so it is the only
  // thing deciding what paints over what). Colourless on purpose: the notes are this pane's colour.
  if (win && win.to > win.from) {
    const band = document.createElement("div");
    band.style.cssText = `position:absolute;top:0;bottom:0;left:${pctX(win.from)}%;width:${pctX(win.to - win.from)}%;box-sizing:border-box;background:rgba(255,255,255,0.06);border-left:1px solid rgba(226,232,240,0.45);border-right:1px solid rgba(226,232,240,0.45)`;
    band.title = `plays ${win.from}–${win.to} beats (from/to)`;
    body.appendChild(band);
  }

  for (let s = 0; s <= steps; s++) {
    const onBeat = s % stepsPerBeat === 0;
    const onBar = s % stepsPerBar === 0;
    const line = document.createElement("div");
    line.style.cssText = `position:absolute;top:0;bottom:0;left:${(s / steps) * 100}%;width:1px;background:rgba(255,255,255,${onBar ? 0.18 : onBeat ? 0.09 : 0.03})`;
    body.appendChild(line);
  }

  const renderNote = (n: Note) => {
    const el = document.createElement("div");
    const v = n.v ?? 1;
    el.style.cssText = `position:absolute;top:${rowTop(n.k)}%;height:${rowH}%;left:${pctX(n.t)}%;width:${pctX(n.d)}%;box-sizing:border-box;border:1px solid var(--sh-background,#111);border-radius:2px;background:var(--sh-primary,#6ea8fe);opacity:${0.35 + 0.65 * v};overflow:hidden;color:var(--sh-background,#111);text-align:center;font-size:9px;line-height:1;display:flex;align-items:center;justify-content:center`;
    const sym = rack?.toSymbol.get(n.k);
    if (sym) el.textContent = sym; // captions the bar with the rack symbol
    el.title = sym
      ? `${sym} — note ${n.k} · t=${n.t} d=${n.d}`
      : `${label(n.k)}  t=${n.t} d=${n.d}${n.v !== undefined ? ` v=${n.v}` : ""}`;
    body.appendChild(el);
  };
  notes.forEach(renderNote);

  // Click toggles the note under the cursor; cell size follows the body's live rect, since it stretches with the pane.
  body.addEventListener("mousedown", (e) => {
    const rect = body.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0) return;
    const k = Math.max(
      lo,
      Math.min(hi, hi - Math.floor((y / rect.height) * rows)),
    );
    const step = Math.max(
      0,
      Math.min(steps - 1, Math.floor((x / rect.width) * steps)),
    );
    const t = step * GRID;
    const hit = notes.find(
      (n) => n.k === k && t >= n.t - 1e-9 && t < n.t + n.d - 1e-9,
    );
    const next = hit
      ? notes.filter((n) => n !== hit)
      : [...notes, { t, d: GRID, k }];
    next.sort((a, b) => a.t - b.t || a.k - b.k);
    e.preventDefault();
    onChange(next);
  });

  return root;
}
