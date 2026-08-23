// gainTrim.ts — the header meter's Fix button, as arithmetic: a pass that clipped, and where the
// OUT node's Volume has to land for that pass to have peaked at -6 dB. Pure, so the thing that
// would be wrong silently — the size of the trim — can be pinned without an engine.
// See apps/st0/frontend/docs/masterMeter.md.

import {
  MASTER_MAX_DB,
  MASTER_MIN_DB,
} from "@studio/song-schema/yaml/projectSchema";

/** Where a fixed mix should peak: -6 dB gives the headroom back, and is where the meter already turns amber (`HOT_DB`). */
export const TARGET_DB = -6;

/** How much the output has to come down — NEVER POSITIVE, and the peak is floored at full scale, the pass having clipped (docs/masterMeter.md). */
export const trimFor = (peakDb: number): number =>
  Math.min(0, TARGET_DB - Math.max(0, peakDb));

/** The OUT node's new Volume: RELATIVE, the meter reading downstream of this very gain, and CLAMPED to the field. */
export const fixedMaster = (masterDb: number, peakDb: number): number =>
  Math.max(MASTER_MIN_DB, Math.min(MASTER_MAX_DB, masterDb + trimFor(peakDb)));
