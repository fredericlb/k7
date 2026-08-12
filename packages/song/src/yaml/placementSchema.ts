// placementSchema.ts — one placed clip or sequence, in Zod, and the timecode rule that governs
// it. Its own file because a placement is no longer a track's alone: a lane is a module now
// (docs/trackModules.md), so moduleSchema is what carries `clips:` and this is what it imports.
// A placement's timecodes ("25:1") must be QUOTED — unquoted, YAML 1.1 reads them as sexagesimal
// numbers (bar 25 silently becomes beat 1501). See moduleFile's quoteTimecodes.

import { z } from "zod";

// The shape a position/duration has: colon-separated numbers — why every one is written QUOTED.
export const TIMECODE = /^[0-9]+(:[0-9]+)*$/;
const Timecode = z
  .string()
  .regex(TIMECODE, "expected a timecode like 25:1 or 8:0:3");

/**
 * One placed clip or sequence on a lane: WHERE it goes and HOW MANY TIMES.
 *
 * What it plays is not said here. The material's own file carries `from`/`to` — the window into the sample or
 * into the notes — so every placement of it plays the same thing, and the arrangement is left to say only what
 * belongs to the arrangement. A placement therefore has no `length` and no `offset`: its extent is derived,
 * `loop` × the window, and there is no second place for it to disagree with the material.
 */
export const PlacementSchema = z
  .object({
    ref: z.string().min(1),
    start: Timecode.optional(),
    fadeIn: Timecode.optional(),
    fadeOut: Timecode.optional(),
    // How many times the window is played, back to back. 1 (the default) is one pass.
    loop: z.number().int().min(1).optional(),
    // Silences THIS placement without removing it — the event-level counterpart of bypassing
    // the lane itself. The placement stays in the file, so its position, length and fades
    // survive being switched off and back on.
    disabled: z.boolean().optional(),
  })
  .strict();

export type Placement = z.infer<typeof PlacementSchema>;

/** Is this key's value a timecode, and so a thing that must be written quoted? */
export const TIMECODE_KEYS = new Set([
  "start",
  "fadeIn",
  "fadeOut",
  // The material's own window, in sequences/<id>.yaml — the same quoting trap for the same reason.
  "from",
  "to",
]);
