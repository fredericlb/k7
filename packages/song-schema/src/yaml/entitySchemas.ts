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

/** A clip is PICTURE when its source ends in one of these — the whole reason a clip file can say only `source:`. */
export const VIDEO_SOURCE = /\.(mp4|mov|m4v|webm|mkv)$/i;

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
// 0..1, scaling every curve's output — the whole range at 1, the default (packages/song/docs/curves.md).
const Amplitude = z.number().min(0).max(1);
// Which half of the output a curve keeps — absent is `none`, the whole of it.
const Cut = z.enum(["none", "positive", "negative"]);
const ConditionTime = z
  .string()
  .regex(TIMECODE, "expected a timecode like 5:1:1 — a position in the song");
// WHEN a curve runs: from a moment, until one, between two, or from a node's event — packages/song/docs/curves.md.
export const CurveConditionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      at: ConditionTime,
      retrigger: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("end"),
      at: ConditionTime,
      retrigger: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("between"),
      start: ConditionTime,
      end: ConditionTime,
      retrigger: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("event"),
      event: z.string().min(1),
      retrigger: z.boolean().optional(),
    })
    .strict(),
]);

export const LfoCurveSchema = z
  .object({
    type: z.literal("lfo"),
    polarity: Polarity.optional(),
    amplitude: Amplitude.optional(),
    cut: Cut.optional(),
    conditions: z.array(CurveConditionSchema).optional(),
    shape: z.enum(["sine", "triangle", "saw", "square"]).optional(),
    frequency: z.number().positive().optional(), // cycles per bar
    phase: z.number().min(0).max(1).optional(),
    // How long it runs, a 0-based timecode ("2:0" is two bars); "0" or absent is for ever.
    duration: z
      .string()
      .regex(TIMECODE, 'expected a length like 2:0 — "0" runs for ever')
      .optional(),
  })
  .strict();

export const CustomCurveSchema = z
  .object({
    type: z.literal("custom"),
    polarity: Polarity.optional(),
    amplitude: Amplitude.optional(),
    cut: Cut.optional(),
    conditions: z.array(CurveConditionSchema).optional(),
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
    amplitude: Amplitude.optional(),
    cut: Cut.optional(),
    conditions: z.array(CurveConditionSchema).optional(),
    attack: z.number().min(0).optional(), // ms, 0 -> instant
    decay: z.number().min(0).optional(), // ms
    sustain: z.number().min(0).optional(), // ms — a HOLD, see above
    release: z.number().min(0).optional(), // ms
    level: z.number().min(0).max(1).optional(), // where decay lands (default 0.5)
  })
  .strict();

/** A BOOLEAN param's curve: drawn points of 0 or 1, each held until the next — no ramp, no depth, no polarity. */
export const OnOffCurveSchema = z
  .object({
    type: z.literal("onoff"),
    points: z
      .array(
        z
          .object({
            time: z.string().regex(TIMECODE, "expected a timecode like 2:1:1"),
            value: z.union([z.literal(0), z.literal(1)], {
              message: "an on/off curve is 0 or 1",
            }),
          })
          .strict(),
      )
      .min(1),
    conditions: z.array(CurveConditionSchema).optional(),
  })
  .strict();

export const CurveSchema = z.discriminatedUnion("type", [
  LfoCurveSchema,
  CustomCurveSchema,
  AdsrCurveSchema,
  OnOffCurveSchema,
]);

const Px = z.number();

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
    // Absent is an ACTIVATION: a span saying the lane is ON, which is how a shape is put on
    // screen and taken off again — see packages/song-video/docs/shapes.md.
    ref: z.string().min(1).optional(),
    start: z.number().min(0).optional(), // seconds on the timeline
    length: z.number().min(0).optional(), // 0 == to the end of the source
    source_from: z.number().min(0).optional(),
    // Seconds, and a DURATION rather than a position — the audio placement's fadeIn in this file's dialect.
    fade_in: TransitionSchema.optional(),
    fade_out: TransitionSchema.optional(),
  })
  .strict()
  // Three keys that need a source, on an event that has none: each would be read by nothing.
  .superRefine((p, ctx) => {
    if (p.ref) return;
    for (const key of ["source_from", "fade_in", "fade_out"] as const)
      if (p[key] != null)
        ctx.addIssue({
          code: "custom",
          message: `an event with no \`ref\` is an ACTIVATION — it says WHEN this lane is on, and has no source to ${key === "source_from" ? "trim" : "fade"}`,
          path: [key],
        });
  });

export const VideoTrackSchema = z
  .object({
    name: z.string().optional(),
    color: z.string().optional(),
    mute: z.boolean().optional(), // "mute" == hidden; no sound on a video lane
    x: Px.optional(),
    y: Px.optional(),
    w: Px.optional(),
    h: Px.optional(),
    events: z.array(VideoPlacementSchema).optional(), // the shots it places — see #Module's `events:`
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
