// surfaceSchema.ts — `surfaces/<name>.yaml`'s shape, in Zod: a special VIEW a project asks its
// editor to draw, what kind it is, where it goes, and which module each of its components is
// wired to. The wiring reuses `views/mix.yaml`'s binding, being the same question.
// Full rationale: docs/surfaces.md.

import { z } from "zod";
import { ViewBindingSchema } from "./mixViewSchema";

/**
 * The kinds of surface there are: m9's desk, the ARRANGEMENT — the timeline — and the FRAME.
 *
 * An ENUM rather than free text, unlike the control ids in the mapping below, and the two are
 * not inconsistent. A control id is the app's vocabulary and grows whenever a panel gains a
 * knob; a surface TYPE is a component that has to exist in the editor, so a folder naming one
 * nothing can draw is a project that will open onto an empty screen with no explanation. That
 * is worth refusing at the schema, by name, with the list of what there is.
 *
 * All three are declared the same way: a song says it wants an arrangement exactly as a set says
 * it wants a desk, or a song with picture says it wants a frame. Nothing is implicit, so a
 * project that draws none of them opens on its graph and is told why. See docs/surfaces.md.
 */
export const SURFACE_TYPES = ["turntables", "timeline", "viewport"] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

/**
 * Where a surface goes: its own screen off the header (`view`), or a slot in the layout that
 * shares the window with the graph (`split`).
 *
 * Two axes rather than one, deliberately — the same turntables could be a screen or a band under
 * the arrangement, and that is a layout rather than a kind. What each TYPE can actually be drawn
 * in is `SURFACE_LAYOUTS_BY_TYPE` below: the axes stay independent, and which pairs the editor
 * has a component for is a separate, checkable fact.
 */
export const SURFACE_LAYOUTS = ["view", "split"] as const;
export type SurfaceLayout = (typeof SURFACE_LAYOUTS)[number];

/**
 * Which layouts each type can be DRAWN in, today.
 *
 * The pair is checked for the reason `type` is an enum at all: a `turntables` asking for `split`
 * or a `timeline` asking for `view` names something the editor has no component for, and the
 * result is a blank screen with no explanation. Refused here, by name, with the list — rather
 * than discovered on screen.
 *
 * A `split` surface is not a `view` surface drawn smaller. It takes a slot in the layout, is
 * mounted for as long as the project is open (its caret and its zoom stack outlive being hidden),
 * and joins the pane ring — which is the whole of why the two are separate words.
 *
 * `viewport` is `split` for the sharpest version of that reason: it owns a WebGL context and one
 * `<video>` element per layer. As a `view` it would tear both down whenever you looked at
 * something else and rebuild them — with a decoder flush and a visible hitch — whenever you came
 * back. `full` is how the picture gets big, which is the pane ring doing its job.
 */
export const SURFACE_LAYOUTS_BY_TYPE: Record<
  SurfaceType,
  readonly SurfaceLayout[]
> = {
  turntables: ["view"],
  timeline: ["split"],
  viewport: ["split"],
};

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
  .strict()
  // …and the PAIR, which neither enum can see on its own. On `layout`, so the squiggle lands on
  // the line that is wrong rather than on the file.
  .superRefine((s, ctx) => {
    const allowed = SURFACE_LAYOUTS_BY_TYPE[s.type];
    if (allowed && !allowed.includes(s.layout))
      ctx.addIssue({
        code: "custom",
        path: ["layout"],
        message: `a '${s.type}' surface draws in ${allowed.map((l) => `'${l}'`).join(" or ")}, not in '${s.layout}'`,
      });
  });

export type Surface = z.infer<typeof SurfaceSchema>;
