// placementSchema.ts — one event on a lane, in Zod: a placed clip or sequence, or a SHOT, whose
// fields are the same where they mean the same thing. Its own file because a lane is a module
// (docs/trackModules.md), so moduleSchema is what carries `events:` and this is what it imports.
// What a reader gets wrong: which fields a SHOT takes is the compile's to check, since only it
// knows each ref's material. A timecode ("25:1") is a STRING; a number is seconds (docs/moduleFile.md).

import { z } from "zod";
import { AnimateSchema } from "../keyframes";
import { TIMECODE } from "../timecode";

export { TIMECODE } from "../timecode";

const Timecode = z
  .string()
  .regex(TIMECODE, "expected a timecode like 25:1, 8:1:2 or 8:1:2:2.120");

// The same two spellings a clip's window takes — seconds, or a musical position (docs/moduleFile.md).
const WindowEdge = z.union([
  z.number().min(0),
  z.string().regex(TIMECODE, "expected seconds (0.25) or a timecode like 2:1"),
]);

/** A shot's transition, in its map form; bare seconds are widened into it before parsing. */
export const FadeSchema = z
  .object({
    over: z.number().min(0), // seconds
    // A module in modules/video_transitions/, by its bare name; absent is the built-in dissolve, or `over` beside a `chain`.
    with: z.string().min(1).optional(),
    // The head node of a run fed by nothing that lands on this lane: it runs on THIS shot over the fade.
    chain: z.string().min(1).optional(),
  })
  .strict();

// A fade: a timecode DURATION on audio, seconds or a transition map on a shot (song-video docs/transitions.md).
// Checked by its shape rather than as a union: a union reports a typo'd key as a bare "Invalid input" with no path.
const Fade = z.preprocess(
  (v) => (typeof v === "number" ? { over: v } : v),
  z.custom<string | z.infer<typeof FadeSchema>>().superRefine((v, ctx) => {
    const r = (typeof v === "string" ? Timecode : FadeSchema).safeParse(v);
    if (!r.success)
      for (const issue of r.error.issues)
        ctx.addIssue(issue as Parameters<typeof ctx.addIssue>[0]);
  }),
);

/** The keys only a SHOT reads — what an event on audio or MIDI material is refused for carrying. */
export const SHOT_KEYS = [
  "length",
  "animate",
  "speed",
  "effect",
  "silent",
  "pitch",
] as const;

/** The keys that need a SOURCE — what an event with no `ref`, an activation, is refused for carrying. */
const SOURCED_KEYS = [
  "from",
  "to",
  "fadeIn",
  "fadeOut",
  "speed",
  "effect",
  "silent",
  "pitch",
] as const;

/** One event: WHERE, HOW MANY TIMES, and WHICH PART — a shot also says how LONG (docs/moduleFile.md). */
export const PlacementSchema = z
  .object({
    // Absent is an ACTIVATION, a span saying a lane of shapes is on (song-video docs/shapes.md).
    ref: z.string().min(1).optional(),
    // Seconds or a musical position, as a window edge is: a shot stays where the clock says when the tempo changes.
    start: WindowEdge.optional(),
    from: WindowEdge.optional(),
    to: WindowEdge.optional(),
    fadeIn: Fade.optional(),
    fadeOut: Fade.optional(),
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
    // SHOTS only, in seconds: how long it is on the timeline, 0 to the end of the source.
    length: z.number().min(0).optional(),
    // …how it MOVES inside its lane's frame, from its own start — song-video docs/animation.md.
    animate: AnimateSchema.optional(),
    // …how fast the source runs under it: 2 is double, 0 a freeze, -1 backwards from `from` — song-video docs/speed.md.
    speed: z.number().finite().optional(),
    // …the head node of a run fed by nothing landing on its lane, run on it alone — song-video docs/effects.md.
    effect: z.string().min(1).optional(),
    // …and its SOUND is not played, its picture still is — packages/song/docs/videoSound.md.
    silent: z.boolean().optional(),
    // …and how its sound follows a `speed`: resampled like `tape` (the default), or stretched to `keep` its pitch.
    pitch: z.enum(["tape", "keep"]).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    // A backwards window is refused where the line can be named, exactly as the clip's own is.
    if (
      typeof p.to === "number" &&
      typeof p.from === "number" &&
      p.to <= p.from
    )
      ctx.addIssue({
        code: "custom",
        message: "'to' must be greater than 'from'",
        path: ["to"],
      });
    // Backwards from `from` reaches the source's first frame after from/|speed| seconds.
    const speed = p.speed ?? 1;
    const from = typeof p.from === "number" ? p.from : 0;
    if (p.ref && speed < 0 && (p.length ?? 0) > 0)
      if (from + (p.length ?? 0) * speed < -5e-4)
        ctx.addIssue({
          code: "custom",
          message: `backwards at ${-speed}× from ${from}s, this shot runs out of source after ${(from / -speed).toFixed(3)}s — shorten it, or start it later in its source`,
          path: ["length"],
        });
    if (p.ref) return;
    for (const key of SOURCED_KEYS)
      if (p[key] != null)
        ctx.addIssue({
          code: "custom",
          message: `an event with no \`ref\` is an ACTIVATION — it says WHEN a lane of shapes is on, and has no source for \`${key}\``,
          path: [key],
        });
  });

export type Placement = z.infer<typeof PlacementSchema>;
