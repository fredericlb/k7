// placementSchema.ts — one placed clip or sequence, in Zod, and the timecode rule that governs
// it. Its own file because a lane is a module (docs/trackModules.md), so moduleSchema is what
// carries `events:` and this is what it imports. A timecode ("25:1") is a STRING; a number is seconds.

import { z } from "zod";

/** The shape a position/duration has — see docs/moduleFile.md. */
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
    // Seconds or a musical position, as a window edge is: a shot stays where the clock says when the tempo changes.
    start: WindowEdge.optional(),
    from: WindowEdge.optional(),
    to: WindowEdge.optional(),
    fadeIn: Timecode.optional(),
    fadeOut: Timecode.optional(),
    // How many times the window is played, back to back. 1 (the default) is one pass.
    loop: z.number().int().min(1).optional(),
    // AUDIO events only: this event's own trim in dB, ±6 — 0 (the default) is unity (packages/song-edit/docs/eventGain.md).
    gain: z.number().min(-6).max(6).optional(),
    // Silences THIS placement without removing it — the event-level counterpart of bypassing the lane.
    disabled: z.boolean().optional(),
    // Whether THIS event plays the material's stretch map, absent meaning yes (docs/moduleFile.md).
    warp: z.boolean().optional(),
    // Other performances of this event, each a material and the song position it starts at (packages/song/docs/takes.md).
    takes: z
      .array(z.object({ ref: z.string().min(1), start: Timecode }).strict())
      .optional(),
    // …and which of them plays over which span, in SONG positions — not the window edges `from`/`to` above.
    comp: z
      .array(
        z
          .object({ take: z.string().min(1), from: Timecode, to: Timecode })
          .strict(),
      )
      .optional(),
    // …and the crossfades at its seams: a song position and a duration, each centred on the seam it smooths.
    crossfades: z
      .array(z.object({ at: Timecode, length: Timecode }).strict())
      .optional(),
  })
  .strict()
  // A backwards window is refused where the line can be named, exactly as the clip's own is.
  .refine(
    (p) =>
      typeof p.to !== "number" || typeof p.from !== "number" || p.to > p.from,
    { message: "'to' must be greater than 'from'", path: ["to"] },
  );

export type Placement = z.infer<typeof PlacementSchema>;
