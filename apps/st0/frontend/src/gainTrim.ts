// gainTrim.ts — the header meter's Fix button, as arithmetic: a pass that clipped, and the one
// gain change that brings every strip down together until the peak sits at -6 dB. Pure, so the
// two things that would be wrong silently — the size of the trim, and which strips get it —
// can be pinned without an engine. See apps/st0/frontend/docs/masterMeter.md.

/**
 * Where a fixed mix should peak.
 *
 * -6 dB and not -0.1: the point is not to squeeze under the ceiling, it is to give the mix back
 * the headroom it was mixed without. It is also where the meter already turns amber (`HOT_DB`),
 * so the button lands the bar exactly at the mark a person reads as "loud but fine".
 */
export const TARGET_DB = -6;

/** The floor and ceiling a strip's Volume may be written to — the mixer widget's own range. */
export const MIN_DB = -60;
export const MAX_DB = 6;

/**
 * How much every strip has to come down, given the loudest the master got.
 *
 * NEVER POSITIVE, and that is the guard that matters. `masterClipped` is the engine's latched
 * "one sample went over full scale"; `master` is a level read at 20 Hz. The two can disagree —
 * a single sample over the line inside a window whose reported level is well under it — so a
 * naive `TARGET_DB - peak` could come back positive and the Fix button would make a mix that
 * clipped LOUDER.
 *
 * The same disagreement is why the peak is floored at 0 first: the pass clipped, so it reached
 * full scale whatever the meter averaged out to, and 0 dB is the least it can honestly be called.
 * That makes the trim at least -6 dB, rather than a button that does nothing.
 */
export const trimFor = (peakDb: number): number =>
  Math.min(0, TARGET_DB - Math.max(0, peakDb));

/** One strip to write: the mixer NODE, and the Volume to put on it. */
export interface TrimmedStrip {
  node: string;
  db: number;
}

/**
 * Every mixer to lower, and to what — the same trim on all of them, so the MIX does not change.
 *
 * That is the whole promise of the button: one number off every fader moves the sum by exactly
 * that number and leaves every balance in the song where the person put it. Anything cleverer —
 * lowering the loudest lane, riding what peaked — would be mixing on their behalf.
 *
 * By NODE, deduplicated: two lanes may end on one shared bus strip, and writing it twice would
 * be either a wasted round trip or, if the two disagreed about its current level, a race. The
 * first lane that reaches a strip decides, which keeps the writes in track order.
 *
 * A lane with no strip contributes nothing. It is not "at unity" — it has nowhere to put a
 * level, so there is nothing here to lower and inventing a node for it would be a lie.
 *
 * CLAMPED to the fader's own range, and that is the one place the promise bends: a strip already
 * near the floor cannot come down the full trim, so its balance against the others shifts. It is
 * accepted rather than worked around because -60 dB is silence — a lane that quiet contributes
 * nothing to the peak this is fixing, so what shifts is inaudible.
 *
 * A strip already at the value it would be written is dropped: nothing to say, no command to run.
 */
export function trimmedStrips(
  strips: readonly { mixer: string; volume: number }[],
  peakDb: number,
): TrimmedStrip[] {
  // No `trim === 0` guard: the button is only offered on a pass that CLIPPED, so the peak is
  // floored at full scale and the trim is always -6 dB or steeper. A strip that would not move is
  // dropped below on its own merits, which is the only no-op that can actually happen here.
  const trim = trimFor(peakDb);
  const seen = new Set<string>();
  const out: TrimmedStrip[] = [];
  for (const s of strips) {
    if (!s.mixer || seen.has(s.mixer)) continue;
    seen.add(s.mixer);
    const db = Math.max(MIN_DB, Math.min(MAX_DB, s.volume + trim));
    if (Math.abs(db - s.volume) < 1e-9) continue;
    out.push({ node: s.mixer, db });
  }
  return out;
}
