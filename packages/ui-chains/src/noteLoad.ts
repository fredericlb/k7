// noteLoad.ts — what a MIDI cable is carrying at an instant: the velocities of every note
// SOUNDING there, summed. Nothing meters MIDI — the engine sends levels for sound and nothing
// for notes — so this is derived in the browser from the notes it already holds, the way
// videoSpans.ts derives the picture. See ui-chains-react/docs/liveCables.md.

/** One note as this measure sees it: when it sounds, in SECONDS, and how hard. */
export interface NoteSpan {
  from: number;
  to: number;
  vel: number;
}

/** The velocities sounding at `t`, summed. Half-open, as every span rule here is. */
export function noteLoadAt(spans: readonly NoteSpan[], t: number): number {
  let sum = 0;
  for (const n of spans) if (t >= n.from && t < n.to) sum += n.vel;
  return sum;
}

/**
 * The busiest instant in the whole part — what `midiFlow` normalises against.
 *
 * A sweep of the edges rather than a sample of the timeline: the peak is always AT a note's
 * start, since that is the only moment the sum goes up, so checking those is both exact and
 * cheap. Sampling would miss a chord shorter than the step.
 */
export function peakLoad(spans: readonly NoteSpan[]): number {
  let peak = 0;
  for (const at of spans) {
    const sum = noteLoadAt(spans, at.from);
    if (sum > peak) peak = sum;
  }
  return peak;
}

/** One lane's notes and the peak they reach — computed once, read on every meter frame. */
export interface LaneNotes {
  spans: readonly NoteSpan[];
  peak: number;
}

/** …for every lane that has any. A lane with no notes is left OUT, as videoSpans leaves one out. */
export function laneNotes(
  byLane: Readonly<Record<string, readonly NoteSpan[]>>,
): Record<string, LaneNotes> {
  const out: Record<string, LaneNotes> = {};
  for (const id in byLane) {
    const spans = byLane[id];
    if (spans.length) out[id] = { spans, peak: peakLoad(spans) };
  }
  return out;
}
