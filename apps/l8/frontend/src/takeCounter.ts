// takeCounter.ts — what the clip panel's header counts: the pre-roll down to zero, then the beats
// of the take. Pure, because the bug it replaces was arithmetic on a stale number and nothing here
// was testable while it lived inside a component that also drew a canvas.

export interface TakeCount {
  phase: "count-in" | "recording";
  /** Beats REMAINING in the pre-roll, or beats recorded so far. Never negative, never absurd. */
  beats: number;
}

/**
 * Where a take is, from the transport's own beat positions.
 *
 * `startBeat` is the playhead when the transport STARTED — which is what the old code got wrong.
 * It captured that once per mount and the pane outlived the take, so from the second take onward
 * it was measuring against the first take's start while `curBeat` was an absolute song position:
 * a take punched in at bar 15 counted 56 beats the instant it began, and a take starting earlier
 * than the last one showed a pre-roll of tens of beats. "Trop grand ou aléatoire" was exactly it.
 *
 * Both results are CLAMPED, and that is not belt-and-braces: the pre-roll can never be longer than
 * the pre-roll, and a take can never have run for less than nothing. Whatever the engine does with
 * its playhead during a count-in — and that is its business, not this counter's — the worst this
 * can now show is a number that stops moving, rather than one nobody can explain.
 */
export function takeCounter(
  startBeat: number,
  curBeat: number,
  countInBeats: number,
): TakeCount {
  const preRoll = Math.max(0, countInBeats);
  const elapsed = curBeat - startBeat;
  if (elapsed < preRoll)
    return {
      phase: "count-in",
      beats: Math.min(preRoll, Math.max(0, Math.ceil(preRoll - elapsed))),
    };
  return {
    phase: "recording",
    beats: Math.max(0, Math.floor(elapsed - preRoll)),
  };
}

/**
 * The beat the take's MATERIAL starts on: the transport's start plus the count-in.
 *
 * `startBeat` is where the transport rolled, not where recording begins — the count-in runs
 * between them — and every surface that draws a take has to know the difference. The growing
 * clip on the lane drew from `startBeat`, so it appeared the instant Play was pressed and, once
 * recording did start, stretched back over bars that hold nothing.
 */
export function recordingFrom(startBeat: number, countInBeats: number): number {
  return startBeat + Math.max(0, countInBeats);
}

/** The take's position as bar:beat, 1-based — a live counter, so x/4 is assumed as it always was. */
export function barBeat(
  recordedBeats: number,
  beatsPerBar: number,
): { bar: number; beat: number } {
  const bpb = Math.max(1, beatsPerBar);
  const b = Math.max(0, Math.floor(recordedBeats));
  return { bar: Math.floor(b / bpb) + 1, beat: (b % bpb) + 1 };
}
