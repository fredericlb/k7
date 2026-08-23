// takeCounter.ts — what the clip panel's header counts: the pre-roll down to zero, then the beats
// of the take. Pure, because the bug it replaces was arithmetic on a stale number and nothing here
// was testable while it lived inside a component that also drew a canvas.

export interface TakeCount {
  phase: "count-in" | "recording";
  /** Beats REMAINING in the pre-roll, or beats recorded so far. Never negative, never absurd. */
  beats: number;
}

/** Where a take is, from the transport's own beat positions — both results CLAMPED, so the worst this shows is a number that stops moving. */
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

/** The beat the take's MATERIAL starts on: the transport's start plus the count-in, which is the difference every surface must know. */
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
