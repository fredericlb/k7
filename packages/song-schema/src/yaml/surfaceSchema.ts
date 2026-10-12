// surfaceSchema.ts — `surfaces/<name>.yaml`'s shape, in Zod: a special VIEW a project asks its
// editor to draw, what kind it is, where it goes, and which module each of its components is
// wired to. The wiring reuses `views/mix.yaml`'s binding, being the same question.
// Full rationale: docs/surfaces.md.

import { z } from "zod";
import { MixViewSchema } from "./mixViewSchema";

/** The kinds of surface there are — an ENUM, since one nothing can draw is a blank screen (docs/surfaceFiles.md). */
export const SURFACE_TYPES = [
  "turntables",
  "timeline",
  "viewport",
  "mastering",
] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

/** Is this word one of them? So the narrowing happens once instead of as a cast wherever a typed string arrives. */
export const isSurfaceType = (s: string): s is SurfaceType =>
  (SURFACE_TYPES as readonly string[]).includes(s);

/** Where a surface goes — its own screen (`view`), a page of the layout (`split`) or a window over it (`floating`); nothing draws in `view` today. */
export const SURFACE_LAYOUTS = ["view", "split", "floating"] as const;
export type SurfaceLayout = (typeof SURFACE_LAYOUTS)[number];

/** Which layouts each type can be DRAWN in today — a `split` is not a `view` drawn smaller, see docs/surfaceFiles.md. */
export const SURFACE_LAYOUTS_BY_TYPE: Record<
  SurfaceType,
  readonly SurfaceLayout[]
> = {
  turntables: ["split"],
  timeline: ["split"],
  // A window over every page, moved and sized by hand: a picture is watched WHILE you edit, never instead of it.
  viewport: ["floating"],
  // `split` and one reason of its own: this desk is a picture of ONE node, checked against the graph beside it.
  mastering: ["split"],
};

/** Which components each type has and what each wants, `[id, note]` — a COPY held to its original by a test elsewhere (docs/surfaceFiles.md). */
export const SURFACE_MAPPING_SKELETON: Record<
  SurfaceType,
  readonly (readonly [string, string])[]
> = {
  timeline: [],
  viewport: [],
  // Ten components naming the SAME module, and three more offered,, in the SIGNAL's order rather than the panel's (docs/surfaceFiles.md).
  mastering: [
    // OFFERED, not required, like the two below: To Vinyl 4's stages, off unless set (engine docs/quickMaster.md).
    [
      "comp.lowCut",
      "the quick-master module — its low cut on the mid, before it compresses",
    ],
    ["comp.low", "the SAME module — how much it compresses the lows"],
    ["comp.mid", "the SAME module — how much on the mids"],
    ["comp.high", "the SAME module — how much on the highs"],
    ["comp.lowFreq", "the SAME module — the crossover between lows and mids"],
    ["comp.highFreq", "the SAME module — the crossover between mids and highs"],
    ["spread.width", "the SAME module — the stereo width"],
    [
      "spread.bassMono",
      "the SAME module — the frequency below which the bass is brought to the centre",
    ],
    [
      "limiter.hfLimit",
      "the SAME module — its HF limit, what it takes off the fastest highs",
    ],
    ["limiter.drive", "the SAME module — the limiter's input gain"],
    ["limiter.ceiling", "the SAME module — its ceiling"],
    ["limiter.release", "the SAME module — its release time"],
    // OFFERED but not REQUIRED: a master with no word length is a master in float (engine docs/quickMaster.md).
    [
      "limiter.output",
      "the SAME module — its output word length, float, 24-bit or 16-bit",
    ],
  ],
  turntables: [
    ["crossfade", "a crossfade module — its mix param"],
    ...["A", "B"].flatMap(
      (d) =>
        [
          [`deck${d}.tempo`, `a tempo module — deck ${d}'s stretch`],
          // In the SIGNAL's order: the trim heads the strip, so it comes before the bands it feeds.
          [`deck${d}.trim`, `a trim module — deck ${d}'s input gain`],
          [`deck${d}.eqLow`, `an eq module — deck ${d}'s lows`],
          [`deck${d}.eqMid`, "the SAME eq module — its mids"],
          [`deck${d}.eqHigh`, "the SAME eq module — its highs"],
          [`deck${d}.filter`, `a filter module — deck ${d}'s filter`],
          [`deck${d}.level`, `a level module — deck ${d}'s channel fader`],
          // OFFERED but not REQUIRED, like the stem cuts below: a desk with no effect is a desk.
          [`deck${d}.echo`, `an echo module — deck ${d}'s echo`],
          // The four stem cuts: OFFERED but not REQUIRED, the one place the two lists differ (docs/surfaceFiles.md).
          [`deck${d}.stemDrums`, `a stem module — deck ${d}'s drums`],
          [`deck${d}.stemBass`, `a stem module — deck ${d}'s bass`],
          [`deck${d}.stemOther`, `a stem module — deck ${d}'s other`],
          [`deck${d}.stemVocals`, `a stem module — deck ${d}'s vocals`],
        ] as const,
    ),
  ],
};

/** A surface: what to draw, where, and what its components move — see docs/surfaceFiles.md. */
export const SurfaceSchema = z
  .object({
    type: z.enum(SURFACE_TYPES),
    layout: z.enum(SURFACE_LAYOUTS),
    // The playlist a `turntables` browser lists, by NAME under `_playlists/` — see docs/surfaceFiles.md.
    playlist: z.string().min(1).optional(),
    // Does this desk SEPARATE a record handed to it unprepared? See packages/st0-plugins/docs/turntables/stems.md.
    stems: z.boolean().optional(),
    // `MixViewSchema` itself, not a record built the same way, so the two cannot drift (docs/surfaceFiles.md).
    mapping: MixViewSchema.optional(),
  })
  .strict()
  // …and the PAIR, which neither enum can see on its own; raised on `layout`, the line that is wrong.
  .superRefine((s, ctx) => {
    const allowed = SURFACE_LAYOUTS_BY_TYPE[s.type];
    if (allowed && !allowed.includes(s.layout))
      ctx.addIssue({
        code: "custom",
        path: ["layout"],
        message: `a '${s.type}' surface draws in ${allowed.map((l) => `'${l}'`).join(" or ")}, not in '${s.layout}'`,
      });
    // A playlist on a surface with no song browser is refused rather than ignored (docs/surfaceFiles.md).
    if (s.playlist !== undefined && s.type !== "turntables")
      ctx.addIssue({
        code: "custom",
        path: ["playlist"],
        message: `only a 'turntables' surface reads a playlist — a '${s.type}' draws no song browser`,
      });
    // Same rule, same reason: separating happens when a record goes ON A DECK, and nothing else has one.
    if (s.stems !== undefined && s.type !== "turntables")
      ctx.addIssue({
        code: "custom",
        path: ["stems"],
        message: `only a 'turntables' surface separates a record — a '${s.type}' loads none`,
      });
  });

export type Surface = z.infer<typeof SurfaceSchema>;
