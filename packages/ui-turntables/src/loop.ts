// loop.ts — a loop as the desk holds it, and the two edges the platter is sent. No React and no
// engine, so the arithmetic is testable on its own — the same split beats.ts makes.
//
// The one thing a reader would get wrong: a length in BEATS becomes seconds at the record's OWN
// tempo and never at the fader's. See ../docs/loop.md.

import type { DeckTempo } from "./deck";

/** The lengths a button offers, in beats. Everything else is reached with ÷2 and ×2. */
export const LOOP_BEATS = [4, 8, 16] as const;

/** What ÷2 and ×2 may reach: a thirty-second is a tone, and thirty-two bars is not a loop. */
export const LOOP_MIN_BEATS = 1 / 8;
export const LOOP_MAX_BEATS = 32;

/** What a beat jump moves by before anybody has chosen a length. */
export const DEFAULT_LOOP_BEATS = 4;

/** A loop on one deck. `start` is in SOURCE seconds; `beats` is of the record's own grid. */
export interface DeckLoop {
  start: number;
  beats: number;
  /** Momentary: letting go hands the record back where it would have reached — ../docs/loop.md. */
  roll: boolean;
}

/** The two edges as FRACTIONS of the record, which is what `LoopStart` / `LoopEnd` take. */
export interface LoopEdges {
  start: number;
  end: number;
}

/** One beat in SOURCE seconds. `natural`, not `target`: the grid is a fact about the file. */
export function beatSeconds(tempo: DeckTempo | undefined): number {
  return tempo && tempo.natural > 0 ? 60 / tempo.natural : 0;
}

/** Can this deck loop at all? It takes a measured tempo and a length — no grid, no beats. */
export function canLoop(tempo: DeckTempo | undefined): boolean {
  return beatSeconds(tempo) > 0 && (tempo?.seconds ?? 0) > 0;
}

/** The NEAREST beat to `at`, never the next one: a loop-in a hair late would jump a whole beat.
 *
 * `at` itself when the deck has no grid, so quantising a record nobody measured changes nothing. */
export function snapToBeat(at: number, tempo: DeckTempo | undefined): number {
  const period = beatSeconds(tempo);
  if (!(period > 0)) return at;
  const phase = tempo?.phase ?? 0;
  const snapped = phase + Math.round((at - phase) / period) * period;
  // A grid whose first beat is late puts the nearest one before the record starts.
  return snapped >= 0
    ? snapped
    : snapped + Math.ceil(-snapped / period) * period;
}

/** A length halved or doubled, held between the two ends. */
export function resized(beats: number, factor: number): number {
  return Math.min(LOOP_MAX_BEATS, Math.max(LOOP_MIN_BEATS, beats * factor));
}

/** How many beats long a manual IN → OUT is, rounded to a beat and never shorter than the floor. */
export function beatsBetween(
  from: number,
  to: number,
  tempo: DeckTempo | undefined,
): number {
  const period = beatSeconds(tempo);
  if (!(period > 0)) return DEFAULT_LOOP_BEATS;
  const raw = (to - from) / period;
  // Rounded to a WHOLE beat above one, and to the ÷2 ladder below it — a loop lands on the grid.
  if (raw >= 1) return Math.min(LOOP_MAX_BEATS, Math.round(raw));
  let beats = 1;
  while (beats > LOOP_MIN_BEATS && raw < beats * 0.75) beats /= 2;
  return beats;
}

/** The edges to send, or null when they would not be a loop — off the end, or no grid at all.
 *
 * Clamped INTO the record: a sixteen-beat loop asked for four beats from the end is not one. */
export function loopEdges(
  loop: DeckLoop,
  tempo: DeckTempo | undefined,
): LoopEdges | null {
  const period = beatSeconds(tempo);
  const length = tempo?.seconds ?? 0;
  if (!(period > 0) || !(length > 0)) return null;
  const start = Math.max(0, Math.min(length, loop.start));
  const end = Math.min(length, start + loop.beats * period);
  // Under a beat of room left is a hang rather than a loop — the platter refuses it too.
  if (end - start < period / 16) return null;
  return { start: start / length, end: end / length };
}

/** Where a jump of `beats` lands, held inside the record. Snapped only when quantising is on. */
export function beatJump(
  needle: number,
  beats: number,
  tempo: DeckTempo | undefined,
  quantise: boolean,
): number {
  const period = beatSeconds(tempo);
  const length = tempo?.seconds ?? 0;
  if (!(period > 0) || !(length > 0)) return needle;
  const moved = needle + beats * period;
  return Math.max(
    0,
    Math.min(length, quantise ? snapToBeat(moved, tempo) : moved),
  );
}

/** One param write: a name and a value, for whichever platters a deck has. */
export type LoopParam = readonly [name: string, value: number];

/** What to send, IN ORDER — the order is the contract, not an implementation detail.
 *
 * Turning a loop off moves the END alone: dropping the start first would leave `[0, end]` standing
 * for a block, and the record would be pulled to the top of the loop. Opening one sends `Roll`
 * first, because the platter latches it at the engage. See ../docs/loop.md. */
export function loopParams(
  edges: LoopEdges | null,
  roll: boolean,
  /** Only the length changed: leave the loop engaged, so a roll's shadow survives it. */
  resize = false,
): LoopParam[] {
  // An end below any start at all is OFF, and one message can never be half-applied.
  if (!edges) return [["LoopEnd", 0]];
  if (resize) return [["LoopEnd", edges.end]];
  return [
    ["Roll", roll ? 1 : 0],
    ["LoopStart", edges.start],
    ["LoopEnd", edges.end],
  ];
}

/** The loop in SOURCE SECONDS — for drawing it, the edges on the wire being fractions. */
export function loopSpan(
  loop: DeckLoop | null,
  tempo: DeckTempo | undefined,
): { start: number; end: number } | null {
  const period = beatSeconds(tempo);
  if (!loop || !(period > 0)) return null;
  const end = Math.min(tempo?.seconds ?? 0, loop.start + loop.beats * period);
  return end > loop.start ? { start: loop.start, end } : null;
}
