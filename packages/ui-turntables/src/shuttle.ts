// shuttle.ts — how fast a drag across the waveform runs the record. A pure function, because the
// decision is arithmetic and the arithmetic is the part worth testing: the view holds the pointer
// and integrates this over its own frames. See ../docs/waveform.md.

/** The fastest a full pull runs, as a multiple of real time — a jog wheel's outer edge. */
export const SHUTTLE_MAX = 16;

/** Pixels of travel that buy nothing, so a click that trembles does not move the record. */
export const SHUTTLE_DEAD = 4;

/** How fast a drag of `dx` pixels asks the record to run, in SECONDS OF AUDIO PER SECOND.
 *
 * Signed the way the band reads: the song slides under a fixed playhead, so dragging LEFT pulls
 * what is coming towards you and the answer is positive — forward. Dragging right rewinds.
 *
 * SQUARED rather than proportional. The whole point of a shuttle is that one gesture covers both
 * "nudge it a hair" and "run to the chorus", and a straight line cannot: sized so the far edge is
 * useful, the first few pixels already fly. The curve keeps the middle of the throw slow — a third
 * of the way out is a ninth of the speed — and spends the last third getting fast.
 *
 * The reference is HALF the band, which is the distance from the playhead to the edge: pulling the
 * band's own visible future under the head is the fastest it goes. */
export function shuttleRate(dx: number, width: number): number {
  const half = width / 2 - SHUTTLE_DEAD;
  if (!(half > 0)) return 0;
  const past = Math.abs(dx) - SHUTTLE_DEAD;
  if (past <= 0) return 0;
  const t = Math.min(1, past / half);
  // Left is FORWARD: the audio slides left under the head, so the hand does what the audio does.
  return (dx < 0 ? 1 : -1) * SHUTTLE_MAX * t * t;
}
