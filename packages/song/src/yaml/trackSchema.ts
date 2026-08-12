// trackSchema.ts — tracks/<id>.yaml's shape, in Zod (single | group | strudel). A
// placement's timecodes ("25:1") must be QUOTED — unquoted, YAML 1.1 reads them as
// sexagesimal numbers (bar 25 silently becomes beat 1501). See TIMECODE below.

import { z } from "zod";

// The shape a position/duration has: colon-separated numbers — why every one is written QUOTED (see trackFile.ts).
export const TIMECODE = /^[0-9]+(:[0-9]+)*$/;
const Timecode = z
  .string()
  .regex(TIMECODE, "expected a timecode like 25:1 or 8:0:3");

/**
 * One placed clip or sequence on a track: WHERE it goes and HOW MANY TIMES.
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
    // Silences THIS placement without removing it — the event-level counterpart of a
    // track's `mute`. The placement stays in the file, so its position, length and fades
    // survive being switched off and back on.
    disabled: z.boolean().optional(),
  })
  .strict();

/**
 * One VARIANT of a track's clip list — another take of the same lane.
 *
 * The track's own `clips:` is the first variant and is not repeated here; these are the ones
 * after it. `name` is optional because an unnamed variant is known by its position, which is what
 * makes trying a second arrangement cost nothing to name. See trackAlternatives.ts.
 */
export const AlternativeSchema = z
  .object({
    name: z.string().min(1).optional(),
    clips: z.array(PlacementSchema).optional(),
  })
  .strict();

// Spread into each kind rather than a base schema: a discriminated union needs the discriminant on the object.
const base = {
  color: z.string().optional(),
  mute: z.boolean().optional(),
  solo: z.boolean().optional(),
  disabled: z.boolean().optional(),
  // `docs:` and `todos:` were here. They are gone, not deprecated: a note is a doc module on
  // the graph now — an instance of `@studio/doc`, wired from what it is about — and leaving the
  // fields accepted would have been two ways to write the same thing, one of which nothing
  // displays. This schema is `.strict()`, so a track still carrying one says so by name and by
  // line rather than being read and dropped. See packages/song/docs/docModules.md.
};

// A FROZEN track: the render that stands in for everything the track used to compute, as a project-relative path
// (tracks/<name>.wav, beside the track's own file). Its presence IS the frozen state — there is no second flag to
// disagree with it — and while it is set the track plays that file instead of its material, with its modules
// bypassed because they are already in it. Not on groups: a group computes nothing of its own to bake.
const frozen = z.string().min(1).optional();

export const SingleTrackSchema = z
  .object({
    ...base,
    type: z.literal("single"),
    contentType: z.enum(["audio", "sequences"]).optional(),
    clips: z.array(PlacementSchema).optional(),
    // The variants of `clips` above, which is itself the first of them. Which one PLAYS is
    // `alternative`, by name or by 1-based position; absent means the first. A number is
    // accepted as written, since an unnamed variant is known by one.
    alternatives: z.array(AlternativeSchema).optional(),
    alternative: z
      .union([z.string().min(1), z.number().int().min(1)])
      .optional(),
    frozen,
    // DEAD, and still accepted, the same bargain `modules_from` gets in projectSchema.ts.
    // It named the video track whose placements this one played the sound of — a link that
    // cannot exist now that picture is a `.v1` project of its own. Refusing the key would
    // stop a song that still plays perfectly from opening at all; the compiler reads it no
    // more, and the syntax page says where the picture went.
    video_source: z.string().min(1).optional(),
  })
  .strict();

export const GroupTrackSchema = z
  .object({
    ...base,
    type: z.literal("group"),
    // A group holds no material of its own, only member track ids.
    tracks: z.array(z.string()).optional(),
  })
  .strict();

export const StrudelTrackSchema = z
  .object({
    ...base,
    type: z.literal("strudel"),
    strudel: z
      .string()
      .regex(/^algo\/.+\.strudel$/, "expected algo/<name>.strudel"),
    contentType: z.enum(["audio", "sequences"]).optional(),
    // No `frozen` here: a strudel lane has no material of its own to render — PatternClock fills its clips while
    // the transport rolls, and an offline render of a stopped one bounces silence.
  })
  .strict();

export const TrackSchema = z.discriminatedUnion("type", [
  SingleTrackSchema,
  GroupTrackSchema,
  StrudelTrackSchema,
]);

export type Placement = z.infer<typeof PlacementSchema>;
export type Track = z.infer<typeof TrackSchema>;

/** Is this key's value a timecode, and so a thing that must be written quoted? */
export const TIMECODE_KEYS = new Set([
  "start",
  "fadeIn",
  "fadeOut",
  // The material's own window, in sequences/<id>.yaml — the same quoting trap for the same reason.
  "from",
  "to",
]);
