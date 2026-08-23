// placementSchema.ts — one placed clip or sequence, in Zod, and the timecode rule that governs
// it. Its own file because a placement is no longer a track's alone: a lane is a module now
// (docs/trackModules.md), so moduleSchema is what carries `events:` and this is what it imports.
// A placement's timecodes ("25:1") must be QUOTED — unquoted, YAML 1.1 reads them as sexagesimal
// numbers (bar 25 silently becomes beat 1501). See moduleFile's quoteTimecodes.

import { z } from "zod";

/** The shape a position/duration has, and why every one is written QUOTED — see docs/moduleFile.md. */
export const TIMECODE = /^[0-9]+(:[0-9]+)*(\.[0-9]+)?$/;
const Timecode = z
  .string()
  .regex(TIMECODE, "expected a timecode like 25:1, 8:1:2 or 8:1:2:2.120");

// The same two spellings a clip's window takes — seconds, or a musical position (docs/moduleFile.md).
const WindowEdge = z.union([
  z.number().min(0),
  z.string().regex(TIMECODE, "expected seconds (0.25) or a timecode like 2:1"),
]);

/** One placed clip or sequence: WHERE, HOW MANY TIMES, and WHICH PART — no length (docs/moduleFile.md). */
export const PlacementSchema = z
  .object({
    ref: z.string().min(1),
    start: Timecode.optional(),
    from: WindowEdge.optional(),
    to: WindowEdge.optional(),
    fadeIn: Timecode.optional(),
    fadeOut: Timecode.optional(),
    // How many times the window is played, back to back. 1 (the default) is one pass.
    loop: z.number().int().min(1).optional(),
    // Silences THIS placement without removing it — the event-level counterpart of bypassing the lane.
    disabled: z.boolean().optional(),
    // Whether THIS event plays the material's stretch map, absent meaning yes (docs/moduleFile.md).
    warp: z.boolean().optional(),
  })
  .strict()
  // A backwards window is refused where the line can be named, exactly as the clip's own is.
  .refine(
    (p) =>
      typeof p.to !== "number" || typeof p.from !== "number" || p.to > p.from,
    { message: "'to' must be greater than 'from'", path: ["to"] },
  );

export type Placement = z.infer<typeof PlacementSchema>;

/** Is this key's value a timecode, and so a thing that must be written quoted? */
export const TIMECODE_KEYS = new Set([
  "start",
  "fadeIn",
  "fadeOut",
  // The window's two words; a NUMBER under them is untouched, being seconds rather than a timecode.
  "from",
  "to",
  // A CURVE point's position — not a placement's key, but the same trap (docs/curves.md).
  "time",
]);
