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

/** Where a surface goes — its own screen (`view`) or a slot beside the graph (`split`); nothing draws in `view` today. */
export const SURFACE_LAYOUTS = ["view", "split"] as const;
export type SurfaceLayout = (typeof SURFACE_LAYOUTS)[number];

/** Which layouts each type can be DRAWN in today — a `split` is not a `view` drawn smaller, see docs/surfaceFiles.md. */
export const SURFACE_LAYOUTS_BY_TYPE: Record<
  SurfaceType,
  readonly SurfaceLayout[]
> = {
  turntables: ["split"],
  timeline: ["split"],
  viewport: ["split"],
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
  // Ten components naming the SAME module, in the SIGNAL's order rather than the panel's (docs/surfaceFiles.md).
  mastering: [
    [
      "comp.low",
      "le module quick-master — sa quantité de compression sur le grave",
    ],
    ["comp.mid", "le MÊME module — sa quantité sur le médium"],
    ["comp.high", "le MÊME module — sa quantité sur l'aigu"],
    ["comp.lowFreq", "le MÊME module — la coupure entre grave et médium"],
    ["comp.highFreq", "le MÊME module — la coupure entre médium et aigu"],
    ["spread.width", "le MÊME module — la largeur stéréo"],
    [
      "spread.bassMono",
      "le MÊME module — la fréquence sous laquelle le grave est ramené au centre",
    ],
    ["limiter.drive", "le MÊME module — le gain d'entrée du limiteur"],
    ["limiter.ceiling", "le MÊME module — son plafond"],
    ["limiter.release", "le MÊME module — son temps de retour"],
  ],
  turntables: [
    ["crossfade", "un module crossfade — son param de mélange"],
    ...["A", "B"].flatMap(
      (d) =>
        [
          [
            `deck${d}.tempo`,
            `un module tempo — l'étirement de la platine ${d}`,
          ],
          [`deck${d}.eqLow`, `un module eq — le grave de la platine ${d}`],
          [`deck${d}.eqMid`, "le MÊME module eq — son médium"],
          [`deck${d}.eqHigh`, "le MÊME module eq — son aigu"],
          [
            `deck${d}.filter`,
            `un module filter — le filtre de la platine ${d}`,
          ],
          // The four stem cuts: OFFERED but not REQUIRED, the one place the two lists differ (docs/surfaceFiles.md).
          [
            `deck${d}.stemDrums`,
            `un module stem — la batterie de la platine ${d}`,
          ],
          [`deck${d}.stemBass`, `un module stem — la basse de la platine ${d}`],
          [
            `deck${d}.stemOther`,
            `un module stem — le reste de la platine ${d}`,
          ],
          [
            `deck${d}.stemVocals`,
            `un module stem — la voix de la platine ${d}`,
          ],
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
    // Does this desk SEPARATE a record handed to it unprepared? See packages/ui-turntables/docs/stems.md.
    stems: z.boolean().optional(),
    // `MixViewSchema` itself, not a record built the same way — the two drifted once (docs/surfaceFiles.md).
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
