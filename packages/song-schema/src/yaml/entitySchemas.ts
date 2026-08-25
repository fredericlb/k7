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
    // Switch the map OFF while keeping it — the expensive half stays on disk (docs/entityFiles.md).
    disable: z.boolean().optional(),
  })
  .strict();

const VIDEO_SOURCE = /\.(mp4|mov|m4v|webm|mkv)$/i;

/** `from`/`to` window the SOURCE FILE, in seconds or as a timecode — see docs/entityFiles.md. */
const WindowEdge = z.union([
  z.number().min(0), // seconds
  z.string().regex(TIMECODE, "expected seconds (0.25) or a timecode like 2:1"),
]);

/** CORRECTIONS to the onsets the engine detected, in source seconds — not the onsets (docs/entityFiles.md). */
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
  // A backwards window compiles to a clip that plays nothing, so it is refused where the line can be named.
  .refine(
    (c) =>
      typeof c.to !== "number" || typeof c.from !== "number" || c.to > c.from,
    { message: "'to' must be greater than 'from'", path: ["to"] },
  );

export const VideoClipSchema = z
  .object({ source: z.string().regex(VIDEO_SOURCE) })
  .strict();

// Audio or video, told apart by the source's EXTENSION, which lets a clip file say only `source:`.
export const ClipSchema = z.union([VideoClipSchema, AudioClipSchema]);

/** One note — and, on a step sequencer, one PAD, which is why two effects live here (docs/padEffects.md). */
export const NoteSchema = z
  .object({
    t: z.number().min(0), // onset, beats (fractional = microtiming)
    d: z.number().positive(), // duration, beats
    k: z.number().int().min(0).max(127), // MIDI key
    v: z.number().min(0).max(1).optional(), // velocity, default 1
    // Retrigger: play the note this many times inside its OWN duration; absent == once.
    repeat: z.number().int().min(2).optional(),
    // Fall silent on every n-th pass of the pattern; absent == every pass (docs/entityFiles.md).
    skip: z.number().int().min(2).optional(),
  })
  .strict();

/** A sequence's window, the MIDI counterpart of a clip's `from`/`to` — timecodes ONLY (docs/entityFiles.md). */
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

/** An envelope in MILLISECONDS, restarted by an event, all four stages durations — see docs/entityFiles.md. */
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

/** The map form of a transition; the bare seconds spelling is widened into it before parsing. */
export const FadeSchema = z
  .object({
    over: z.number().min(0), // seconds
    // A module in modules/video_transitions/, by its bare name; absent is the built-in dissolve.
    with: z.string().min(1).optional(),
  })
  .strict();

/** How a shot arrives or leaves: seconds alone is the built-in dissolve — see song-video/docs/transitions.md. */
// Widened rather than a union: a union reports a typo'd key as a bare "Invalid input" with no line.
export const TransitionSchema = z.preprocess(
  (v) => (typeof v === "number" ? { over: v } : v),
  FadeSchema,
);

export const VideoPlacementSchema = z
  .object({
    ref: z.string().min(1),
    start: z.number().min(0).optional(), // seconds on the timeline
    length: z.number().min(0).optional(), // 0 == to the end of the source
    source_from: z.number().min(0).optional(),
    // Seconds, and a DURATION rather than a position — the audio placement's fadeIn in this file's dialect.
    fade_in: TransitionSchema.optional(),
    fade_out: TransitionSchema.optional(),
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
  .strict()
  // A fade_out is measured back from an END, and the LAST length-0 shot has none — the only case with no answer.
  // A length-0 shot with another after it is fine: its end is that one's start, which is activeAt's own rule.
  .superRefine((t, ctx) => {
    const ev = t.events;
    if (!ev?.length) return;
    const i = ev.length - 1;
    if (ev[i].fade_out && !ev[i].length)
      ctx.addIssue({
        code: "custom",
        message:
          "fade_out needs an end, and this shot has `length: 0` with nothing after it — give it a length, or put a shot after it",
        path: ["events", i, "fade_out"],
      });
  });

/** The kinds this file covers, by their folder name — what a loader looks up. */
export const ENTITY_SCHEMAS = {
  clips: ClipSchema,
  sequences: SequenceSchema,
  curves: CurveSchema,
  video_tracks: VideoTrackSchema,
} as const;
