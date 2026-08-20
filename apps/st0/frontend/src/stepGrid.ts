// stepGrid.ts — the step sequencer's arithmetic: the grid a clip's window divides into at a
// chosen precision, and which cell a note lights. Pure, because a button that writes a note is
// exactly the arithmetic worth pinning — the drawing is a table of buttons around these numbers.

import type { WebNote } from "./types";

/**
 * The precisions offered, as note values — `1/4` is a quarter note, which is ONE beat in this
 * model (beats are quarter-note beats everywhere here). A list rather than a free number so the
 * toggle is three keystrokes and the grid never lands on a step nothing musical means.
 */
export const PRECISIONS = [
  { label: "1/2", beats: 2 },
  { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 },
  { label: "1/16", beats: 0.25 },
] as const;
export type Precision = (typeof PRECISIONS)[number];

/** Two beat positions that are the same one — the tolerance every note edit here uses. */
const EPS = 1e-6;

/**
 * The cells of a window `[origin, origin + span)` at `step` beats each, as ABSOLUTE beat starts.
 *
 * The grid is FIXED: it divides the window, not the notes, so every row shows the same columns
 * and a bar reads down the page. A window that does not divide evenly keeps its last, partial
 * cell — the material is what it is, and dropping the tail would hide real positions.
 */
export function stepCells(
  origin: number,
  span: number,
  step: number,
): number[] {
  if (!(step > 0) || !(span > 0)) return [];
  const out: number[] = [];
  // Counted, not accumulated: adding 0.25 four hundred times drifts, and a grid whose cells are
  // one ulp off its own window misses the notes it wrote (the same rule ticksUpTo follows).
  for (let i = 0; i * step < span - EPS; i++) out.push(origin + i * step);
  return out;
}

/**
 * The note that LIGHTS the cell at `cellStart`: the first one on `key` starting anywhere inside
 * `[cellStart, cellStart + step)`.
 *
 * Anywhere inside, not exactly on the line: a note recorded live or drawn at a finer zoom still
 * belongs to some cell, and a grid that only saw its own writes would show a playing sequence as
 * empty. Toggling such a cell OFF removes the note at its REAL start — the address is the
 * note's, not the cell's.
 */
export function noteInCell(
  notes: readonly WebNote[],
  key: number,
  cellStart: number,
  step: number,
): WebNote | null {
  for (const n of notes)
    if (
      n.key === key &&
      n.time >= cellStart - EPS &&
      n.time < cellStart + step - EPS
    )
      return n;
  return null;
}

/** The keys the rack has NO row for but the window's notes use — distinct, high first, the way
 *  a roll stacks pitches. They become EXTRA rows: a played take with keys the rack does not
 *  name must show, not be counted away. Window-bounded — outside is the cage's business. */
export function unknownKeys(
  notes: readonly WebNote[],
  rowKeys: readonly number[],
  origin: number,
  span: number,
): number[] {
  const keys = new Set(rowKeys);
  const out = new Set<number>();
  for (const n of notes)
    if (
      !keys.has(n.key) &&
      n.time < origin + span - EPS &&
      n.time + n.duration > origin + EPS
    )
      out.add(n.key);
  return [...out].sort((a, b) => b - a);
}

/**
 * Every note that lights a cell, keyed `<key>@<cellIndex>` — ONE pass over the notes.
 *
 * The grid used to ask `noteInCell` per cell, which is a scan of every note per cell: sixteen
 * rows of sixty-four cells over a hundred notes is a hundred thousand comparisons, redone on
 * every render — and a velocity drag renders on every pointer frame. Same rule as `noteInCell`
 * (a note belongs to the cell its START falls in, first one wins), read from the other side.
 */
export function notesByCell(
  notes: readonly WebNote[],
  origin: number,
  span: number,
  step: number,
): Map<string, WebNote> {
  const out = new Map<string, WebNote>();
  if (!(step > 0) || !(span > 0)) return out;
  const count = Math.ceil((span - EPS) / step);
  for (const n of notes) {
    const i = Math.floor((n.time - origin + EPS) / step);
    if (i < 0 || i >= count) continue;
    const key = `${n.key}@${i}`;
    if (!out.has(key)) out.set(key, n); // first wins, as noteInCell's scan did
  }
  return out;
}

/**
 * How far inside its own step a note sits, in HUNDREDTHS of that step — a pad's nudge.
 *
 * 0..99 by construction, because a note belongs to the cell its start falls in (`notesByCell`):
 * a hundredth is the resolution, the step is the range. That bound is also the gesture's, and it
 * is what keeps a pad under the cursor while the wheel turns — see the panel's `onCellWheel`.
 *
 * Rounded, because it is a READING of a position rather than the position itself. A take
 * recorded live lands wherever it landed, and the pad says which hundredth that is nearest.
 */
export const NUDGE_MAX = 99;
export function nudgeOf(time: number, cellStart: number, step: number): number {
  if (!(step > 0)) return 0;
  const raw = Math.round(((time - cellStart) / step) * 100);
  return Math.max(0, Math.min(NUDGE_MAX, raw));
}

/**
 * …and back: the beat a pad nudged by `n` hundredths starts on.
 *
 * Rounded to six decimals, which is the same courtesy the velocity drag pays: the finest value
 * this can produce is a hundredth of a 1/16 note — four decimals — so nothing is lost, and a
 * file full of `4.092500000000001` would be noise in a diff. It also keeps the beat a later edit
 * ADDRESSES identical to the one written, which is how a note is found again.
 */
export function nudgedTime(cellStart: number, step: number, n: number): number {
  const t = cellStart + (Math.max(0, Math.min(NUDGE_MAX, n)) / 100) * step;
  return Math.round(t * 1e6) / 1e6;
}

/** One optimistic edit: what a pad was set to before the document could say so. */
export interface PadEdit {
  on: boolean;
  /** 0..1 for a velocity drag; absent means "on, at whatever the note carries". */
  vel?: number;
  /** Hundredths of a step, for a nudge; absent means "wherever the note already is". */
  nudge?: number;
}

/**
 * Which optimistic edits the document has caught up with — the ones to forget.
 *
 * A press paints its cell at once and fires a command; the reload that proves it lands ~half a
 * second later. Holding the ghost until the document AGREES is the timeline's rule for a clip
 * drag, and it is what stops a cell flickering back to its old state in between. An edit the
 * document contradicts is kept, not dropped: it is still in flight.
 */
export function settledEdits(
  pending: ReadonlyMap<string, PadEdit>,
  byCell: ReadonlyMap<string, WebNote>,
  /** The cell starts, by the same key — a nudge is only readable against the step it is off. */
  cellStartOf?: (key: string) => number | undefined,
  step = 0,
): string[] {
  const out: string[] = [];
  for (const [key, edit] of pending) {
    const hit = byCell.get(key);
    const cellStart = cellStartOf?.(key);
    const agrees = edit.on
      ? !!hit &&
        (edit.vel === undefined ||
          Math.abs((hit.vel ?? 1) - edit.vel) < 1e-6) &&
        // A nudge settles when the note is ON that hundredth. Without the cell it cannot be
        // read at all, so an edit carrying one waits rather than being declared done.
        (edit.nudge === undefined ||
          (cellStart !== undefined &&
            nudgeOf(hit.time, cellStart, step) === edit.nudge))
      : !hit;
    if (agrees) out.push(key);
  }
  return out;
}
