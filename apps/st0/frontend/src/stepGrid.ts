// stepGrid.ts — the step sequencer's arithmetic: the grid a clip's window divides into at a
// chosen precision, and which cell a note lights. Pure, because a button that writes a note is
// exactly the arithmetic worth pinning — the drawing is a table of buttons around these numbers.

import type { WebNote } from "./types";

/** The precisions offered, as note values — a list rather than a free number, so the grid never lands on a step nothing musical means. */
export const PRECISIONS = [
  { label: "1/2", beats: 2 },
  { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 },
  { label: "1/16", beats: 0.25 },
] as const;
export type Precision = (typeof PRECISIONS)[number];

/** Two beat positions that are the same one — the tolerance every note edit here uses. */
const EPS = 1e-6;

/** The cells of a window at `step` beats each, as ABSOLUTE beat starts — the grid divides the WINDOW, and keeps its last partial cell. */
export function stepCells(
  origin: number,
  span: number,
  step: number,
): number[] {
  if (!(step > 0) || !(span > 0)) return [];
  const out: number[] = [];
  // Counted, not accumulated: adding 0.25 four hundred times drifts, and a grid one ulp off its own window misses its own notes.
  for (let i = 0; i * step < span - EPS; i++) out.push(origin + i * step);
  return out;
}

/** The note that LIGHTS the cell at `cellStart` — anywhere inside, not exactly on the line, and toggling it off removes it at its REAL start. */
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

/** The keys the rack has NO row for but the window's notes use, high first — a played take must show, not be counted away. */
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

/** Every note that lights a cell, keyed `<key>@<cellIndex>` — ONE pass, where per-cell scanning was a hundred thousand comparisons a render. */
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

/** How far inside its own step a note sits, in HUNDREDTHS — 0..99 by construction, and rounded, being a READING of a position. */
export const NUDGE_MAX = 99;
export function nudgeOf(time: number, cellStart: number, step: number): number {
  if (!(step > 0)) return 0;
  const raw = Math.round(((time - cellStart) / step) * 100);
  return Math.max(0, Math.min(NUDGE_MAX, raw));
}

/** …and back: the beat a pad nudged by `n` hundredths starts on, rounded to six decimals so a later edit addresses the same beat. */
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

/** Which optimistic edits the document has caught up with — one the document contradicts is kept, being still in flight. */
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
        // A nudge settles when the note is ON that hundredth; without the cell it cannot be read at all, so it waits.
        (edit.nudge === undefined ||
          (cellStart !== undefined &&
            nudgeOf(hit.time, cellStart, step) === edit.nudge))
      : !hit;
    if (agrees) out.push(key);
  }
  return out;
}

/** A dragged selection, planned: the command's moves, and which pads to clear and light before it lands. */
export type SelectionMove =
  | {
      moves: [number, number, number, number][];
      lift: string[];
      land: { key: string; vel?: number }[];
    }
  | { refused: "empty" | "outside" | "occupied" };

/**
 * Where every note the rectangle holds lands when it is dragged `dRow` rows and `dCol` steps.
 * Rows go through `rowNotes` — a row is a rack sound, not a semitone — and each note keeps its
 * nudge inside its step. Refused when a note would leave the grid or land on a pad that stays.
 */
export function planSelectionMove(a: {
  box: { rowLo: number; rowHi: number; colLo: number; colHi: number };
  dRow: number;
  dCol: number;
  rowNotes: readonly number[];
  cells: readonly number[];
  byCell: ReadonlyMap<string, WebNote>;
}): SelectionMove {
  const picked: { r: number; c: number; n: WebNote }[] = [];
  for (let r = a.box.rowLo; r <= a.box.rowHi; r++)
    for (let c = a.box.colLo; c <= a.box.colHi; c++) {
      const n = a.byCell.get(`${a.rowNotes[r]}@${c}`);
      if (n) picked.push({ r, c, n });
    }
  if (!picked.length) return { refused: "empty" };
  const leaving = new Set(picked.map((p) => `${a.rowNotes[p.r]}@${p.c}`));
  const moves: [number, number, number, number][] = [];
  const land: { key: string; vel?: number }[] = [];
  for (const { r, c, n } of picked) {
    const nr = r + a.dRow;
    const nc = c + a.dCol;
    if (nr < 0 || nr >= a.rowNotes.length || nc < 0 || nc >= a.cells.length)
      return { refused: "outside" };
    const key = `${a.rowNotes[nr]}@${nc}`;
    if (a.byCell.has(key) && !leaving.has(key)) return { refused: "occupied" };
    // The note's offset inside its step rides along, rounded so a float's tail never reaches the file.
    const nt = Math.round((a.cells[nc] + (n.time - a.cells[c])) * 1e6) / 1e6;
    moves.push([n.key, n.time, a.rowNotes[nr], nt]);
    land.push({ key, ...(n.vel === undefined ? {} : { vel: n.vel }) });
  }
  const landing = new Set(land.map((l) => l.key));
  return { moves, lift: [...leaving].filter((k) => !landing.has(k)), land };
}
