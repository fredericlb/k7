// TrackerGrid.ts — the inline TRACKER view of a sequence's notes: time top-to-bottom, one
// row per step, simultaneous notes spread across channel columns, keyboard-driven like the
// trackers it apes. Plain DOM inside a CodeMirror widget; the cursor lives in a
// caller-owned ctx so it survives a rebuild. See docs/noteGrids.md.

import type { Note, RackInfo } from "./notes";

const GRID = 0.25; // step = a sixteenth, in beats
const STEPS_PER_BAR = 16; // 4 beats / 0.25
const ROW_H = 16; // px per step row
const GUTTER_W = 34; // px, the row-index column
const CH_W = 64; // px per channel column (fits `C-4` + its MIDI number)
const EPS = 1e-9;

// Two-char note names so every cell is one width (`C-`, `C#`); octave is MIDI's, 60 → C-4 like the rest of st0.
const NAMES2 = [
  "C-",
  "C#",
  "D-",
  "D#",
  "E-",
  "F-",
  "F#",
  "G-",
  "G#",
  "A-",
  "A#",
  "B-",
];
export const fmtKey = (k: number) =>
  `${NAMES2[((k % 12) + 12) % 12]}${Math.floor(k / 12) - 1}`;

// The classic FastTracker/Renoise key layout, z-row an octave under q. Arrows move, so the letters stay free.
const KEYMAP: Record<string, number> = {
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  ",": 12,
  l: 13,
  ".": 14,
  ";": 15,
  "/": 16,
  q: 12,
  "2": 13,
  w: 14,
  "3": 15,
  e: 16,
  r: 17,
  "5": 18,
  t: 19,
  "6": 20,
  y: 21,
  "7": 22,
  u: 23,
  i: 24,
  "9": 25,
  o: 26,
  "0": 27,
  p: 28,
};

// Cursor + focus for the tracker. Caller-owned so it outlives a widget rebuild.
export interface TrackerCtx {
  row: number;
  ch: number;
  octave: number; // the display octave a bare note key lands in (C-<octave>)
  focused: boolean;
}

export function makeTrackerCtx(): TrackerCtx {
  return { row: 0, ch: 0, octave: 4, focused: false };
}

// Greedily spread notes over channel columns so none overlap. Derived per render and deterministic, the file
// having no channel field — so a given note list always lays out the same way.
export function assignChannels(notes: Note[]): {
  channels: number;
  cell: Map<Note, { ch: number; row: number }>;
} {
  const sorted = [...notes].sort((a, b) => a.t - b.t || a.k - b.k);
  const colEnd: number[] = []; // end beat of the last note placed in each column
  const cell = new Map<Note, { ch: number; row: number }>();
  for (const n of sorted) {
    let ch = colEnd.findIndex((end) => end <= n.t + EPS);
    if (ch < 0) {
      ch = colEnd.length;
      colEnd.push(0);
    }
    colEnd[ch] = n.t + n.d;
    cell.set(n, { ch, row: Math.round(n.t / GRID) });
  }
  return { channels: Math.max(1, colEnd.length), cell };
}

// The note occupying cell (ch,row), if any, under the current channel assignment.
const noteAt = (notes: Note[], ch: number, row: number): Note | undefined => {
  const { cell } = assignChannels(notes);
  return notes.find((n) => {
    const c = cell.get(n)!;
    return c.ch === ch && c.row === row;
  });
};

// Put pitch `k` at (ch,row), replacing any note there. Pure and re-sorted, so keys and tests share one definition.
export function placeNote(
  notes: Note[],
  ch: number,
  row: number,
  k: number,
): Note[] {
  const clamped = Math.max(0, Math.min(127, k));
  const existing = noteAt(notes, ch, row);
  const next = existing
    ? notes.map((n) => (n === existing ? { ...n, k: clamped } : n))
    : [...notes, { t: row * GRID, d: GRID, k: clamped }];
  return next.sort((a, b) => a.t - b.t || a.k - b.k);
}

// Remove the note at cell (ch,row); a no-op (returns the same list) if it's empty.
export function removeNoteAt(notes: Note[], ch: number, row: number): Note[] {
  const hit = noteAt(notes, ch, row);
  return hit ? notes.filter((n) => n !== hit) : notes;
}

// MIDI key for a semitone above the C of display octave `octave` (C-4 == 60).
export const keyForOctave = (octave: number, semitone: number): number =>
  (octave + 1) * 12 + semitone;

export function renderTrackerGrid(
  notes: Note[],
  ctx: TrackerCtx,
  onChange: (next: Note[]) => void,
  // With a rack (use_rack), notes show and enter as SYMBOLS: cells render them, a palette lists them, 1-9 place them.
  rack: RackInfo | null = null,
  // The file's `from`/`to`, in beats — the span that PLAYS. Null when the file states none.
  win: { from: number; to: number } | null = null,
): HTMLElement {
  const { channels, cell } = assignChannels(notes);
  // The window joins the content span, so a `to` past the last hit still has rows to reach.
  const endBeat = Math.max(
    notes.reduce((m, n) => Math.max(m, n.t + n.d), 4),
    win?.to ?? 0,
  );
  const totalBeats = Math.ceil(endBeat / 4) * 4; // whole bars, at least one
  const steps = Math.round(totalBeats / GRID);
  // Which rows PLAY. Half-open, as the window is: a note starting exactly on `to` is outside it.
  const winRows =
    win && win.to > win.from
      ? {
          first: Math.round(win.from / GRID),
          last: Math.round(win.to / GRID) - 1,
        }
      : null;

  // Clamp the persisted cursor to the grid it's landing back on.
  ctx.row = Math.max(0, Math.min(steps - 1, ctx.row));
  ctx.ch = Math.max(0, Math.min(channels - 1, ctx.ch));

  // onset[ch][row] = the note starting there; sustain[ch][row] = a note holds through.
  const onset: (Note | undefined)[][] = Array.from({ length: channels }, () =>
    new Array<Note | undefined>(steps).fill(undefined),
  );
  const sustain: boolean[][] = Array.from({ length: channels }, () =>
    new Array<boolean>(steps).fill(false),
  );
  for (const n of notes) {
    const c = cell.get(n)!;
    if (c.row < steps) onset[c.ch][c.row] = n;
    const endRow = Math.round((n.t + n.d) / GRID);
    for (let r = c.row + 1; r < endRow && r < steps; r++)
      sustain[c.ch][r] = true;
  }

  const root = document.createElement("div");
  root.className = "td-tracker";
  root.tabIndex = 0;
  root.style.cssText =
    "position:relative;overflow:auto;height:100%;width:100%;background:var(--sh-background,#111);font:12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--sh-muted-foreground,#888);outline:none;cursor:default;user-select:none";

  // Sticky header: the octave notes will land in, then a number per channel.
  const header = document.createElement("div");
  header.style.cssText = `position:sticky;top:0;z-index:2;display:flex;height:${ROW_H}px;background:var(--sh-background,#111);border-bottom:1px solid var(--sh-border,#333)`;
  const octLabel = document.createElement("div");
  octLabel.style.cssText = `width:${GUTTER_W}px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:var(--sh-primary,#6ea8fe)`;
  // A rack drives notes by symbol, so the octave selector is meaningless — the gutter shows a rack marker instead.
  const setOctLabel = () =>
    (octLabel.textContent = rack ? "rk" : `o${ctx.octave}`);
  setOctLabel();
  octLabel.title = rack
    ? "rack mode — notes shown/entered as symbols (see the palette)"
    : "octave notes land in ([ / ] to change)";
  header.appendChild(octLabel);
  for (let c = 0; c < channels; c++) {
    const h = document.createElement("div");
    h.style.cssText = `width:${CH_W}px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:var(--sh-muted-foreground,#888)`;
    h.textContent = `${c + 1}`;
    header.appendChild(h);
  }
  root.appendChild(header);

  // The rack palette: one chip per sound with its digit shortcut, sticky so it stays visible while the grid scrolls.
  if (rack) {
    const bar = document.createElement("div");
    bar.style.cssText = `position:sticky;top:${ROW_H}px;z-index:2;display:flex;flex-wrap:wrap;gap:4px;padding:3px ${GUTTER_W}px 3px 4px;background:var(--sh-background,#111);border-bottom:1px solid var(--sh-border,#333)`;
    rack.order.forEach((s, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      const key = i < 9 ? `${i + 1}` : "·";
      chip.textContent = `${key} ${s.symbol}`;
      chip.title = `${s.symbol} — note ${s.note}${i < 9 ? ` (key ${i + 1})` : ""}`;
      chip.style.cssText =
        "font:11px/1 ui-monospace,monospace;padding:2px 6px;border:1px solid var(--sh-border,#333);border-radius:3px;background:var(--sh-background,#111);color:var(--sh-primary,#6ea8fe);cursor:pointer";
      chip.addEventListener("mousedown", (e) => e.preventDefault()); // keep grid focus
      chip.addEventListener("click", () => {
        root.focus();
        placeSound(i);
      });
      bar.appendChild(chip);
    });
    root.appendChild(bar);
  }

  const body = document.createElement("div");
  body.style.cssText = `position:relative;width:${GUTTER_W + channels * CH_W}px`;
  root.appendChild(body);

  // Element handles so cursor moves and octave changes repaint without a rebuild.
  const cellEls: HTMLDivElement[][] = Array.from(
    { length: channels },
    () => [],
  );
  const rowEls: HTMLDivElement[] = [];

  for (let r = 0; r < steps; r++) {
    const onBeat = r % 4 === 0;
    const onBar = r % STEPS_PER_BAR === 0;
    const rowEl = document.createElement("div");
    // The window is the row's own GROUND, one step lighter than the beat shading it sits on rather
    // than a band over the top: these rows carry text, and a tint above them would dim it.
    const inWin = !!winRows && r >= winRows.first && r <= winRows.last;
    const shade = (onBar ? 0.05 : onBeat ? 0.02 : 0) + (inWin ? 0.06 : 0);
    // The two edges as INSET shadows, not borders: a border would add to a row of fixed height and
    // walk the whole grid a pixel down.
    const edge =
      inWin && winRows
        ? [
            r === winRows.first ? "inset 0 1px 0 rgba(226,232,240,0.5)" : "",
            r === winRows.last ? "inset 0 -1px 0 rgba(226,232,240,0.5)" : "",
          ]
            .filter(Boolean)
            .join(",")
        : "";
    rowEl.style.cssText = `display:flex;height:${ROW_H}px;background:${shade > 0 ? `rgba(255,255,255,${shade})` : "transparent"}${edge ? `;box-shadow:${edge}` : ""}`;
    rowEls.push(rowEl);

    const gut = document.createElement("div");
    gut.style.cssText = `width:${GUTTER_W}px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:${onBar ? "var(--sh-foreground,#ddd)" : "var(--sh-muted-foreground,#666)"}`;
    gut.textContent = r.toString(16).toUpperCase().padStart(2, "0");
    rowEl.appendChild(gut);

    for (let c = 0; c < channels; c++) {
      const cellEl = document.createElement("div");
      cellEl.style.cssText = `width:${CH_W}px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-left:1px solid rgba(255,255,255,0.05)`;
      const n = onset[c][r];
      if (n) {
        // With a rack, a mapped note shows its symbol; an off-map one still shows its note name, so it is never hidden.
        const sym = rack?.toSymbol.get(n.k);
        if (sym) {
          cellEl.textContent = sym;
        } else {
          // The note name, then its raw MIDI number as a dim annotation next to it.
          const nm = document.createElement("span");
          nm.textContent = fmtKey(n.k);
          const num = document.createElement("span");
          num.textContent = String(n.k);
          num.style.cssText = "margin-left:4px;font-size:9px;opacity:0.5";
          cellEl.append(nm, num);
        }
        cellEl.style.color = "var(--sh-primary,#6ea8fe)";
        cellEl.title = sym
          ? `${sym} — note ${n.k} · t=${n.t} d=${n.d}`
          : `t=${n.t} d=${n.d} k=${n.k}${n.v !== undefined ? ` v=${n.v}` : ""}`;
      } else if (sustain[c][r]) {
        cellEl.textContent = "·";
        cellEl.style.color = "rgba(110,168,254,0.5)";
      } else {
        cellEl.textContent = "···";
        cellEl.style.color = "rgba(255,255,255,0.12)";
      }
      const cc = c;
      const rr = r;
      cellEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        root.focus();
        moveTo(rr, cc);
      });
      cellEls[c].push(cellEl);
      rowEl.appendChild(cellEl);
    }
    body.appendChild(rowEl);
  }

  // Paint/unpaint the cursor cell, kept out of the base style so a move is two writes rather than a re-layout.
  let painted: HTMLDivElement | null = null;
  const paintCursor = () => {
    if (painted) painted.style.background = "transparent";
    const el = cellEls[ctx.ch]?.[ctx.row];
    if (!el) return;
    el.style.background = ctx.focused
      ? "var(--sh-primary,#6ea8fe)"
      : "rgba(110,168,254,0.25)";
    painted = el;
  };
  const scrollCursorIntoView = () =>
    rowEls[ctx.row]?.scrollIntoView({ block: "nearest" });

  const moveTo = (row: number, ch: number) => {
    ctx.row = Math.max(0, Math.min(steps - 1, row));
    ctx.ch = Math.max(0, Math.min(channels - 1, ch));
    paintCursor();
    scrollCursorIntoView();
  };

  // Add/replace a note at the cursor with `semitone` above the cursor octave's C.
  const typeNote = (semitone: number) => {
    const next = placeNote(
      notes,
      ctx.ch,
      ctx.row,
      keyForOctave(ctx.octave, semitone),
    );
    ctx.row = Math.min(steps - 1, ctx.row + 1); // auto-advance, tracker style
    onChange(next); // rebuilds the widget; ctx carries the cursor across
  };

  // Place palette sound `i` at the cursor — the rack equivalent of typeNote, driven by the digits and the chips.
  const placeSound = (i: number) => {
    const s = rack?.order[i];
    if (!s) return;
    const next = placeNote(notes, ctx.ch, ctx.row, s.note);
    ctx.row = Math.min(steps - 1, ctx.row + 1);
    onChange(next);
  };

  const clearNote = () => {
    const next = removeNoteAt(notes, ctx.ch, ctx.row);
    if (next !== notes) onChange(next);
  };

  root.addEventListener("focus", () => {
    ctx.focused = true;
    paintCursor();
  });
  root.addEventListener("blur", () => {
    ctx.focused = false;
    paintCursor();
  });

  root.addEventListener("keydown", (e) => {
    // The tracker owns the keyboard while focused: stop every key so the shell's bindings can't fire under the typist.
    let handled = true;
    switch (e.key) {
      case "ArrowUp":
        moveTo(ctx.row - 1, ctx.ch);
        break;
      case "ArrowDown":
        moveTo(ctx.row + 1, ctx.ch);
        break;
      case "ArrowLeft":
        moveTo(ctx.row, ctx.ch - 1);
        break;
      case "ArrowRight":
        moveTo(ctx.row, ctx.ch + 1);
        break;
      case "PageUp":
        moveTo(ctx.row - STEPS_PER_BAR, ctx.ch);
        break;
      case "PageDown":
        moveTo(ctx.row + STEPS_PER_BAR, ctx.ch);
        break;
      case "Home":
        moveTo(0, ctx.ch);
        break;
      case "End":
        moveTo(steps - 1, ctx.ch);
        break;
      case "Backspace":
      case "Delete":
        clearNote();
        break;
      case "[":
        ctx.octave = Math.max(0, ctx.octave - 1);
        setOctLabel();
        break;
      case "]":
        ctx.octave = Math.min(9, ctx.octave + 1);
        setOctLabel();
        break;
      case "Escape":
        root.blur();
        break;
      default: {
        if (rack) {
          // Rack mode: 1-9 place the palette's sounds in order, and the chromatic layout is off — a symbol is what's meant.
          const idx = "123456789".indexOf(e.key);
          if (idx >= 0 && idx < rack.order.length) placeSound(idx);
          else handled = false;
        } else {
          const semi = KEYMAP[e.key.toLowerCase()];
          if (semi === undefined) handled = false;
          else typeNote(semi);
        }
      }
    }
    // Even unhandled keys are swallowed while focused; Tab is the exception, so focus can still leave.
    if (e.key === "Tab") return;
    e.stopPropagation();
    if (handled) e.preventDefault();
  });

  // Restore cursor and focus on the fresh DOM; the element isn't attached yet inside render, so defer a tick.
  paintCursor();
  if (ctx.focused) {
    queueMicrotask(() => {
      root.focus();
      scrollCursorIntoView();
    });
  }

  return root;
}
