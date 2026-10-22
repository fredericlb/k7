// videoPlacementSchema.ts — one shot on a picture lane, in SECONDS: what a video_tracks/ file and a
// timeline's `pictures:` lane both hold. Its own file so timelineSchema.ts can read it without the
// entity schemas, which import the timeline's. See packages/song-video/docs/picture.md.

import { z } from "zod";
import { AnimateSchema } from "../keyframes";

/** The map form of a transition; the bare seconds spelling is widened into it before parsing. */
export const FadeSchema = z
  .object({
    over: z.number().min(0), // seconds
    // A module in modules/video_transitions/, by its bare name; absent is the built-in dissolve, or `over` beside a `chain`.
    with: z.string().min(1).optional(),
    // The head node of a run fed by nothing that lands on this lane: it runs on THIS shot over the fade.
    chain: z.string().min(1).optional(),
  })
  .strict();

/** How a shot arrives or leaves: seconds alone is the built-in dissolve — see song-video/docs/transitions.md. */
// Widened rather than a union: a union reports a typo'd key as a bare "Invalid input" with no line.
const TransitionSchema = z.preprocess(
  (v) => (typeof v === "number" ? { over: v } : v),
  FadeSchema,
);

export const VideoPlacementSchema = z
  .object({
    // Absent is an ACTIVATION, a span saying the lane is ON — packages/song-video/docs/shapes.md.
    ref: z.string().min(1).optional(),
    start: z.number().min(0).optional(), // seconds on the timeline
    length: z.number().min(0).optional(), // 0 == to the end of the source
    source_from: z.number().min(0).optional(),
    // Seconds, and a DURATION rather than a position — the audio placement's fadeIn in this file's dialect.
    fade_in: TransitionSchema.optional(),
    fade_out: TransitionSchema.optional(),
    // How the shot MOVES inside its lane's frame, in seconds from its own start — song-video docs/animation.md.
    animate: AnimateSchema.optional(),
    // How fast the SOURCE runs under the shot: 2 is double, 0 a freeze, -1 backwards from `source_from` — song-video docs/speed.md.
    speed: z.number().finite().optional(),
    // The head node of a run fed by nothing landing on this lane, run on THIS shot for as long as it is on — song-video docs/effects.md.
    effect: z.string().min(1).optional(),
    // The shot's SOUND is not played, its picture still is — packages/song/docs/videoSound.md.
    silent: z.boolean().optional(),
  })
  .strict()
  // Three keys that need a source, on an event that has none: each would be read by nothing.
  .superRefine((p, ctx) => {
    // Backwards from `source_from` reaches the source's first frame after source_from/|speed| seconds.
    const speed = p.speed ?? 1;
    if (p.ref && speed < 0 && (p.length ?? 0) > 0)
      if ((p.source_from ?? 0) + (p.length ?? 0) * speed < -5e-4)
        ctx.addIssue({
          code: "custom",
          message: `backwards at ${-speed}× from ${p.source_from ?? 0}s, this shot runs out of source after ${((p.source_from ?? 0) / -speed).toFixed(3)}s — shorten it, or start it later in its source`,
          path: ["length"],
        });
    if (p.ref) return;
    for (const key of [
      "source_from",
      "fade_in",
      "fade_out",
      "speed",
      "effect",
      "silent",
    ] as const)
      if (p[key] != null)
        ctx.addIssue({
          code: "custom",
          message: `an event with no \`ref\` is an ACTIVATION — it says WHEN this lane is on, and has no source to ${key === "source_from" ? "trim" : key === "speed" ? "run" : key === "effect" ? "grade" : key === "silent" ? "silence" : "fade"}`,
          path: [key],
        });
  });
