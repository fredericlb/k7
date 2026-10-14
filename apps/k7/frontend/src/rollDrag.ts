// rollDrag.ts — what a gesture on the piano roll WRITES, as arithmetic with no DOM.
// Every answer here is read twice: once by the ghost the roll draws and once by the command it
// commits, so a note lands exactly where the drag showed it. The one thing a reader would get
// wrong: a press that never leaves its cell is a note ONE GRID STEP long, not the command's own
// default of a whole beat — on a 1/16 grid those two differ by sixteen cells.
// See apps/k7/frontend/docs/clipEditors.md.

/** The shortest a stretch may leave a note: a 64th at any tempo — a real choice, and not a note vanishing from the roll. */
export const MIN_NOTE_BEATS = 1 / 16;

/** A drag on one note, addressed the way every `sequence note …` verb addresses it: by key and by where it starts NOW. */
export interface RollDrag {
  key: number;
  time: number;
  dur: number;
  /** Which end is in hand, or the whole note — the timeline's own vocabulary for the same gesture. */
  mode: "move" | "start" | "end";
  /** How far it has travelled in time, in beats. */
  dBeats: number;
  /** How far it has travelled in PITCH, in semitones, positive up — a stretch has none. */
  dKeys: number;
}

/** Where a drag has taken the note: ONE answer, read by the preview and by the commit. */
export interface RollSpan {
  key: number;
  start: number;
  end: number;
}

/** Onto the keyboard, rather than off it: a note dragged past either end stops at it (docs/clipEditors.md). */
export const clampKey = (k: number): number =>
  Math.max(0, Math.min(127, Math.round(k)));

export function tSpan(t: RollDrag): RollSpan {
  if (t.mode === "move") {
    const start = Math.max(0, t.time + t.dBeats);
    return { key: clampKey(t.key + t.dKeys), start, end: start + t.dur };
  }
  // A stretch keeps its pitch whatever the hand did: the grips are on the note's ENDS, and an end has no pitch.
  const end = t.time + t.dur;
  return t.mode === "start"
    ? {
        key: t.key,
        start: Math.max(0, Math.min(end - MIN_NOTE_BEATS, t.time + t.dBeats)),
        end,
      }
    : {
        key: t.key,
        start: t.time,
        end: Math.max(t.time + MIN_NOTE_BEATS, end + t.dBeats),
      };
}

/** Did this drag change the note's PITCH? Which verb commits it — `sequence note move` or `sequence note timerange`. */
export const movesPitch = (t: RollDrag): boolean =>
  t.mode === "move" && clampKey(t.key + t.dKeys) !== t.key;

/** Has this drag anything to write at all? A press that has not travelled must commit nothing. */
export const dragMoved = (t: RollDrag): boolean =>
  Math.abs(t.dBeats) > 1e-6 || movesPitch(t);

/**
 * The span a draw gesture covers, in beats — the CELLS it was dragged across, so a note lands
 * where the caret does. `freeLen` is what a Ctrl-freed click is worth, there being no cell to take.
 */
export function drawSpan(
  a: number,
  b: number,
  step: number,
  origin: number,
  freeLen: number,
): { from: number; to: number } {
  if (step <= 0) {
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    return { from, to: to - from > 1e-6 ? to : from + Math.max(1e-6, freeLen) };
  }
  const col = (beat: number) => Math.floor((beat - origin) / step + 1e-9);
  const lo = Math.min(col(a), col(b));
  const hi = Math.max(col(a), col(b));
  // Both ends INCLUSIVE, so a press that never left its cell covers that cell rather than nothing.
  return { from: origin + lo * step, to: origin + (hi + 1) * step };
}

/** How far a pointer has travelled in ROWS, positive up — snapped to the line, and never freed: half a semitone does not exist. */
export const keyOffset = (dy: number, rowH: number): number =>
  rowH > 0 ? -Math.round(dy / rowH) : 0;

/** A velocity from where the pointer sits INSIDE a note's row: 0 at its bottom edge, 1 at its top. */
export function velAt(yInRow: number, rowH: number): number {
  if (rowH <= 1) return 1;
  return Math.max(0, Math.min(1, 1 - yInRow / (rowH - 1)));
}

/** A note as a group drag reads it: where it is now, and what it carries along. */
export interface GroupNote {
  key: number;
  time: number;
  duration: number;
  vel?: number;
}

/**
 * The offset a SELECTION drag may take: clamped so the whole group stays on the keyboard and after
 * beat 0, where `clampKey` would fold a chord onto one key at an edge.
 */
export function groupOffset(
  group: readonly GroupNote[],
  dBeats: number,
  dKeys: number,
): { dBeats: number; dKeys: number } {
  if (!group.length) return { dBeats: 0, dKeys: 0 };
  const lo = Math.min(...group.map((n) => n.key));
  const hi = Math.max(...group.map((n) => n.key));
  const first = Math.min(...group.map((n) => n.time));
  return {
    dBeats: Math.max(-first, dBeats),
    dKeys: Math.max(-lo, Math.min(127 - hi, Math.round(dKeys))),
  };
}

/** Where a selection drag sends every note — `sequence notes move`'s payload — or why it cannot: a note that STAYS is in the way. */
export function planGroupMove(
  group: readonly GroupNote[],
  others: readonly GroupNote[],
  dBeats: number,
  dKeys: number,
):
  | { moves: [number, number, number, number][]; dBeats: number; dKeys: number }
  | { refused: "occupied" | "still" } {
  const off = groupOffset(group, dBeats, dKeys);
  if (Math.abs(off.dBeats) < 1e-6 && off.dKeys === 0)
    return { refused: "still" };
  // Rounded so a pixel's float tail never reaches the file — the velocity drag's own rule, at six places.
  const at = (t: number) => Math.round(t * 1e6) / 1e6;
  const moves = group.map((n): [number, number, number, number] => [
    n.key,
    n.time,
    n.key + off.dKeys,
    at(n.time + off.dBeats),
  ]);
  const taken = (k: number, t: number) =>
    others.some((o) => o.key === k && Math.abs(o.time - t) < 1e-6);
  if (moves.some(([, , k, t]) => taken(k, t))) return { refused: "occupied" };
  return { moves, ...off };
}
