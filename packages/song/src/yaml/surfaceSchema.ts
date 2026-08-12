// surfaceSchema.ts — `surfaces/<name>.yaml`'s shape, in Zod: a special VIEW a project asks its
// editor to draw, what kind it is, where it goes, and which module each of its components is
// wired to. The wiring reuses `views/mix.yaml`'s binding, being the same question.
// Full rationale: docs/surfaces.md.

import { z } from "zod";
import { ViewBindingSchema } from "./mixViewSchema";

/**
 * The kinds of surface there are. One so far: m9's desk — two turntables and a crossfade.
 *
 * An ENUM rather than free text, unlike the control ids in the mapping below, and the two are
 * not inconsistent. A control id is the app's vocabulary and grows whenever a panel gains a
 * knob; a surface TYPE is a component that has to exist in the editor, so a folder naming one
 * nothing can draw is a project that will open onto an empty screen with no explanation. That
 * is worth refusing at the schema, by name, with the list of what there is.
 */
export const SURFACE_TYPES = ["turntables"] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

/**
 * Where a surface goes. One so far: `view` — its own screen, reached from the header.
 *
 * Named rather than assumed because the alternatives are already visible: a surface could be a
 * PANEL beside the graph, or a band under the timeline, and those are layouts rather than
 * types — the same turntables would draw in any of them. Keeping the two axes apart from the
 * first file means adding the second layout does not have to re-cut the first.
 */
export const SURFACE_LAYOUTS = ["view"] as const;
export type SurfaceLayout = (typeof SURFACE_LAYOUTS)[number];

/**
 * A surface: what to draw, where, and what its components move.
 *
 * `mapping` is `views/mix.yaml`'s map, key for key — control id -> `{ module, param }` — and it
 * is the same map because it is the same question, asked by a surface instead of by m9's desk.
 * Reusing `ViewBindingSchema` is what keeps `module` meaning "the name the CHAINS file uses"
 * in both places; a second shape that happened to agree would drift the first time one grew a
 * field. See docs/viewBindings.md for why a binding cannot live in the module's own
 * `controller.yaml`.
 *
 * It is OPTIONAL, and an absent one is not an error here. Which components a given type needs
 * is the surface's own business — `@studio/song` does not know what a `crossfade` is, exactly
 * as it does not for `views/mix.yaml` — so a missing component is reported by whoever DRAWS
 * the surface, on the component, where it can be read against the thing that is not working.
 * Refusing the file instead would refuse to open a project because one knob is unwired.
 */
export const SurfaceSchema = z
  .object({
    type: z.enum(SURFACE_TYPES),
    layout: z.enum(SURFACE_LAYOUTS),
    mapping: z.record(z.string().min(1), ViewBindingSchema).optional(),
  })
  .strict();

export type Surface = z.infer<typeof SurfaceSchema>;
