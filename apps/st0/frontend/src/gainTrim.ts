// gainTrim.ts — the header meter's Fix button, as arithmetic: a pass that clipped, and where the
// OUT node's Volume has to land for that pass to have peaked at -6 dB. Pure, so the thing that
// would be wrong silently — the size of the trim — can be pinned without an engine.
// See apps/st0/frontend/docs/masterMeter.md.

import { MASTER_MAX_DB, MASTER_MIN_DB } from "@studio/song/yaml/projectSchema";

/**
 * Where a fixed mix should peak.
 *
 * -6 dB and not -0.1: the point is not to squeeze under the ceiling, it is to give the mix back
 * the headroom it was mixed without. It is also where the meter already turns amber (`HOT_DB`),
 * so the button lands the bar exactly at the mark a person reads as "loud but fine".
 */
export const TARGET_DB = -6;

/**
 * How much the output has to come down, given the loudest the master got.
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

/**
 * The OUT node's new Volume: where it is now, plus the trim the pass earned.
 *
 * RELATIVE, and it has to be. The meter reads the master bus downstream of this very gain
 * (`packages/song/docs/masterVolume.md`), so the peak already includes whatever the fader was set
 * to while the pass played — `trimFor(peak)` is therefore how much further down it must go, not
 * where it should end up. Writing `trimFor(peak)` absolutely would forget the setting that helped
 * cause the clip.
 *
 * CLAMPED to the field, which is the one place the button bends: an output already near the floor
 * cannot come down the full trim. -100 dB is silence, so a mix that quiet has nothing left to
 * clip and the shortfall is inaudible.
 */
export const fixedMaster = (masterDb: number, peakDb: number): number =>
  Math.max(MASTER_MIN_DB, Math.min(MASTER_MAX_DB, masterDb + trimFor(peakDb)));
