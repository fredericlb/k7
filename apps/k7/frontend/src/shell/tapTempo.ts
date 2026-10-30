// tapTempo.ts — a tempo from the times of a run of taps, as the bpm popin's Tap button measures it.
// A pause longer than TAP_RESET_MS starts a new run, so an old run never drags a new one's average.

/** A gap past this starts over: 2 s is a 30 bpm beat, the slowest a person taps steadily. */
export const TAP_RESET_MS = 2000;
/** The average covers the last few taps only, so a tempo the person is drifting towards wins quickly. */
const TAP_WINDOW = 8;

/** The run after a tap at `now`, and its tempo in whole bpm — null until a second tap gives an interval. */
export function tapTempo(
  taps: readonly number[],
  now: number,
): { taps: number[]; bpm: number | null } {
  const last = taps.at(-1);
  const run =
    last !== undefined && now - last <= TAP_RESET_MS && now > last
      ? [...taps, now].slice(-TAP_WINDOW)
      : [now];
  if (run.length < 2) return { taps: run, bpm: null };
  const mean = (run[run.length - 1] - run[0]) / (run.length - 1);
  return { taps: run, bpm: Math.round(60000 / mean) };
}
