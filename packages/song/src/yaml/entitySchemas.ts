// entitySchemas.ts — the remaining per-entity shapes, in Zod: clips, sequences, curves,
// video tracks. Each is a FLAT file keyed by its own filename (clips/kick.yaml has no
// `id:` — the name is the id), which also rules out one file declaring several ids.

import { z } from "zod";
import { TIMECODE } from "./placementSchema";

/** A stretch map from the DAW a clip was imported from. */
export const WarpSchema = z
  .object({
    algorithm: z.string().min(1),
    // [timeline beat, source second], monotonic, at least two points.
    markers: z.array(z.tuple([z.number(), z.number()])).min(2),
    /**
     * Switch the map OFF while keeping it: the clip plays at its own rate, and the markers wait.
     *
     * The map is the expensive half — an import computes it, and a hand-placed one is minutes of
     * work — so "don't stretch this" cannot be spelled by deleting it. A material declines its own
     * map the way a placement already declines it (`warp: false` on an event, PlacementSchema):
     * same meaning, one level up, and the compiler folds the two into one answer.
     */
    disable: z.boolean().optional(),
  })
  .strict();

const VIDEO_SOURCE = /\.(mp4|mov|m4v|webm|mkv)$/i;

/**
 * `from`/`to` window the SOURCE FILE: the clip plays that slice of it and nothing else, wherever it is placed.
 *
 * Written EITHER way, and the spelling picks the meaning:
 *   from: 0.25      a bare number is SECONDS into the file — tempo-independent, so the trim never moves
 *   from: "2:1"     a timecode is MUSICAL, converted at the project tempo, for material played to the click
 *
 * Both, because both are right for different material. A trimmed field recording wants seconds; a take played
 * to the click wants "drop the first two bars", and every other time field in a track file is a timecode — so
 * refusing one of them would only be a rule to memorise. A rack slice's window is the same two words.
 *
 * Distinct from a placement's `start`, which is musical and says where on the TIMELINE the clip sits. Trimming
 * the sample is a property of the material; where it lands is a property of the arrangement — and the extent
 * is derived, so a placement has no length of its own to disagree with. A placement MAY carry its own
 * `from`/`to`, and then the most restrictive pair wins: an event can narrow this window, never widen it
 * (see PlacementSchema and docs/clipResize.md).
 */
const WindowEdge = z.union([
  z.number().min(0), // seconds
  z.string().regex(TIMECODE, "expected seconds (0.25) or a timecode like 2:1"),
]);

/**
 * Corrections to the onsets the ENGINE detected in this clip's source — not the onsets themselves.
 *
 * The detected set is derived data: it lives in the file's `.cache` sidecar, it is tuned by one global
 * `sensitivity`, and it is rebuilt from scratch whenever the audio's fingerprint changes. Writing a corrected
 * LIST there would be wiped without a word. Writing the corrected list here instead would go stale the moment
 * the threshold moved, and the whole point of the threshold is that it moves.
 *
 * So what is stored is the DIFFERENCE, and that is what survives a re-detection: the two lists say "there is
 * also one here" and "there is not one there", and re-detecting at another sensitivity re-answers everything
 * except those. Moving an onset is a removal plus an addition, which is what moving it in fact is.
 *
 * Both are SECONDS into the source file, like `from`/`to` in their bare-number spelling — never a timecode: an
 * onset is a fact about the material, and would slide under it if it were musical and the tempo were edited.
 */
const OnsetEditsSchema = z
  .object({
    added: z.array(z.number().min(0)).optional(),
    removed: z.array(z.number().min(0)).optional(),
  })
  .strict();

export const AudioClipSchema = z
  .object({
    source: z.string().min(1),
    from: WindowEdge.optional(), // default: the file's start
    to: WindowEdge.optional(), // default: the file's end
    warp: WarpSchema.optional(),
    onsets: OnsetEditsSchema.optional(),
  })
  .strict()
  // A backwards window would compile to a clip that plays nothing, which reads as a broken file rather than a
  // bad number — so it is refused here, where the line can be named. Only checked when both are the same kind:
  // comparing a timecode against seconds needs the tempo, which the schema has no business knowing.
  .refine(
    (c) =>
      typeof c.to !== "number" || typeof c.from !== "number" || c.to > c.from,
    { message: "'to' must be greater than 'from'", path: ["to"] },
  );

export const VideoClipSchema = z
  .object({ source: z.string().regex(VIDEO_SOURCE) })
  .strict();

// Audio or video, told apart by the source's extension rather than a discriminant field —
// which is what #Clip does, and what lets a clip file say only `source:`.
export const ClipSchema = z.union([VideoClipSchema, AudioClipSchema]);

/**
 * One note — and, on a step sequencer, one PAD, which is why two effects live here.
 *
 * `t`/`d`/`k`/`v` are single letters because every note carries all four and a pattern is hundreds
 * of them on one line. `repeat` and `skip` are spelled out instead, deliberately: they appear on
 * the few pads that have an effect, so they cost nothing in width, and a letter apiece would be two
 * more things to learn from a file that no longer explains itself. See docs/padEffects.md.
 */
export const NoteSchema = z
  .object({
    t: z.number().min(0), // onset, beats (fractional = microtiming)
    d: z.number().positive(), // duration, beats
    k: z.number().int().min(0).max(127), // MIDI key
    v: z.number().min(0).max(1).optional(), // velocity, default 1
    // Retrigger: play the note `repeat` times inside its OWN duration, which on a pad is the step
    // it was drawn on. Absent == once.
    repeat: z.number().int().min(2).optional(),
    // Fall silent on every `skip`-th pass of the pattern: 2 plays one pass in two, 4 plays three in
    // four. Absent == every pass. Means nothing on a sequence that is placed once, which is not an
    // error — a placement gaining a `loop:` later is what makes it audible.
    skip: z.number().int().min(2).optional(),
  })
  .strict();

/**
 * A sequence's window, the MIDI counterpart of a clip's `from`/`to`: the part of the notes this sequence IS.
 *
 * Timecodes only, and positions — `"1:1"` is the sequence's first beat, `"5:1"` its fifth bar. No bare numbers
 * here, unlike a clip: a clip's number means SECONDS into a file, and the same spelling meaning beats one folder
 * over is the kind of rule that is only ever learned by getting it wrong.
 */
const SeqEdge = z
  .string()
  .regex(TIMECODE, "expected a timecode like 5:1 — a position in the sequence");

export const SequenceSchema = z
  .object({
    notes: z.array(NoteSchema),
    from: SeqEdge.optional(), // default: the first note
    to: SeqEdge.optional(), // default: the end of the last note
    // A rack module whose symbols name these notes — the tracker relabels by it.
    use_rack: z.string().min(1).optional(),
  })
  .strict();

const Polarity = z.enum(["unipolar", "bipolar"]);

export const LfoCurveSchema = z
  .object({
    type: z.literal("lfo"),
    polarity: Polarity.optional(),
    shape: z.enum(["sine", "triangle", "saw", "square"]).optional(),
    frequency: z.number().positive().optional(), // cycles per bar
    phase: z.number().min(0).max(1).optional(),
  })
  .strict();

export const CustomCurveSchema = z
  .object({
    type: z.literal("custom"),
    polarity: Polarity.optional(),
    points: z
      .array(
        z
          .object({
            time: z.string().regex(TIMECODE, "expected a timecode like 2:1:1"),
            value: z.number(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/**
 * An envelope, in MILLISECONDS, restarted by an event rather than read off song time.
 *
 * The four stages are all durations — sustain included, which a keyboard's ADSR does not do.
 * A keyboard holds sustain until note-OFF, and this envelope has no note-off to wait for: it is
 * baked from the note-ONs of whatever feeds it, so its length has to be knowable in advance.
 * `level` is the one thing that is not a duration — where decay lands and sustain holds.
 *
 * Milliseconds and not beats: an envelope is a gesture of the hand, and a 20ms attack is 20ms
 * at any tempo. Every other curve here is written in bars for the opposite reason.
 */
export const AdsrCurveSchema = z
  .object({
    type: z.literal("adsr"),
    polarity: Polarity.optional(),
    attack: z.number().min(0).optional(), // ms, 0 -> instant
    decay: z.number().min(0).optional(), // ms
    sustain: z.number().min(0).optional(), // ms — a HOLD, see above
    release: z.number().min(0).optional(), // ms
    level: z.number().min(0).max(1).optional(), // where decay lands (default 0.5)
  })
  .strict();

export const CurveSchema = z.discriminatedUnion("type", [
  LfoCurveSchema,
  CustomCurveSchema,
  AdsrCurveSchema,
]);

const Px = z.number();

export const SquareShapeSchema = z
  .object({
    type: z.literal("square"),
    x: Px.optional(),
    y: Px.optional(),
    w: z.number().positive(),
    h: z.number().positive(),
    background_color: z.string().optional(),
  })
  .strict();

export const CircleShapeSchema = z
  .object({
    type: z.literal("circle"),
    x: Px.optional(),
    y: Px.optional(),
    r: z.number().positive(),
    background_color: z.string().optional(),
  })
  .strict();

export const TextShapeSchema = z.looseObject({
  type: z.literal("text"),
  content: z.string().min(1),
});

export const ShapeSchema = z.discriminatedUnion("type", [
  SquareShapeSchema,
  CircleShapeSchema,
  TextShapeSchema,
]);

export const VideoPlacementSchema = z
  .object({
    ref: z.string().min(1),
    start: z.number().min(0).optional(), // seconds on the timeline
    length: z.number().min(0).optional(), // 0 == to the end of the source
    source_from: z.number().min(0).optional(),
  })
  .strict();

export const VideoTrackSchema = z
  .object({
    name: z.string().optional(),
    color: z.string().optional(),
    mute: z.boolean().optional(), // "mute" == hidden; no sound on a video lane
    kind: z.enum(["video", "shape"]).optional(),
    x: Px.optional(),
    y: Px.optional(),
    w: Px.optional(),
    h: Px.optional(),
    events: z.array(VideoPlacementSchema).optional(), // "video" tracks only — see #Module's `events:`
    shapes: z.array(ShapeSchema).optional(), // "shape" tracks only
  })
  .strict();

/** The kinds this file covers, by their folder name — what a loader looks up. */
export const ENTITY_SCHEMAS = {
  clips: ClipSchema,
  sequences: SequenceSchema,
  curves: CurveSchema,
  video_tracks: VideoTrackSchema,
} as const;
