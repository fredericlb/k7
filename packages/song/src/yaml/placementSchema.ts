// placementSchema.ts — one placed clip or sequence, in Zod, and the timecode rule that governs
// it. Its own file because a placement is no longer a track's alone: a lane is a module now
// (docs/trackModules.md), so moduleSchema is what carries `events:` and this is what it imports.
// A placement's timecodes ("25:1") must be QUOTED — unquoted, YAML 1.1 reads them as sexagesimal
// numbers (bar 25 silently becomes beat 1501). See moduleFile's quoteTimecodes.

import { z } from "zod";

// The shape a position/duration has: colon-separated numbers — why every one is written QUOTED.
/**
 * The shape a position/duration has: colon-separated numbers, then optionally `.ticks`.
 *
 * Why every one is written QUOTED, and why the dot makes that stricter rather than looser: `25:1`
 * unquoted is a YAML 1.1 sexagesimal, and `1.5` unquoted is a plain FLOAT in any YAML. The new
 * form collides with a number more readily than the old one did, not less.
 *
 * The colon chain may still run deep here: every file written before ticks existed spells its
 * sub-beats that way, and a schema that refused them would fail songs that load perfectly.
 */
export const TIMECODE = /^[0-9]+(:[0-9]+)*(\.[0-9]+)?$/;
const Timecode = z
  .string()
  .regex(TIMECODE, "expected a timecode like 25:1, 8:1:2 or 8:1:2:2.120");

// The same two spellings a clip's window takes (entitySchemas' WindowEdge): a bare number is
// seconds into a clip's file, a timecode is a musical position — and on a sequence, the only
// spelling that means anything, since its window is beat positions in the notes.
const WindowEdge = z.union([
  z.number().min(0),
  z.string().regex(TIMECODE, "expected seconds (0.25) or a timecode like 2:1"),
]);

/**
 * One placed clip or sequence on a lane: WHERE it goes, HOW MANY TIMES — and, when this event
 * plays less than the material does, WHICH PART.
 *
 * The window exists at TWO levels. The material's own file carries `from`/`to` — the window into
 * the sample or into the notes, shared by every placement of it — and a placement may carry the
 * same two words for ITSELF. The effective window is the most restrictive pair: the larger
 * `from`, the smaller `to`. An event can therefore only narrow what the material already plays,
 * never reach outside it — and `event resize` writes THESE, which is what makes a resize one
 * event's edit instead of every placement's (see song/docs/clipResize.md).
 *
 * A placement still has no `length` and no `offset`: its extent is derived, `loop` × the
 * effective window, and there is no second place for it to disagree with the material.
 */
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
    // Silences THIS placement without removing it — the event-level counterpart of bypassing
    // the lane itself. The placement stays in the file, so its position, length and fades
    // survive being switched off and back on.
    disabled: z.boolean().optional(),
    /**
     * Whether THIS event plays the material's stretch map. Absent ⇒ yes, which is what every
     * placement did before this existed.
     *
     * `warp: false` is the only value that says anything; `true` is the default written out. The
     * polarity is that way round because a warp belongs to the CLIP — one map, shared by every
     * placement of it (docs/warp.md) — and this is a placement declining it. A `noWarp: true`
     * would name the same fact as a double negative, and a reader would have to work out which
     * way `noWarp: false` pointed.
     *
     * What it is for: one map fits the song where the clip was warped INTO, and a second use of
     * that clip somewhere else wants the sample at its own rate. Before this, the only way was to
     * copy the file.
     */
    warp: z.boolean().optional(),
  })
  .strict()
  // A backwards window is refused where the line can be named, exactly as the clip's own is.
  // Only checked when both edges are the same kind: comparing a timecode against seconds needs
  // the tempo, which the schema has no business knowing.
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
  // The window's two words — on a material file AND on a placement, the same quoting trap for
  // the same reason. A NUMBER under these keys is untouched: it is seconds, not a timecode.
  "from",
  "to",
]);
