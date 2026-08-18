// mixViewSchema.ts — `views/mix.yaml`'s shape, in Zod: which control of an app's panel drives
// which module param. Keyed by the CONTROL, because the file is about a desk.
// Full rationale: docs/viewBindings.md.

import { z } from "zod";

/**
 * What one control drives: a module the CHAINS file names, and a param as a widget binds it.
 *
 * `module` is the chain's name for it — `crossfade`, `tempoA` — and not a médiathèque ref: a
 * node is what a set actually has two of, and a ref would be ambiguous the moment a module
 * is used twice. That ambiguity is the whole reason these bindings are not in the module's own
 * `controller.yaml`, which belongs to the device and is shared by every use of it.
 *
 * `param` is spelled exactly as `ui.yaml`'s `bind:` spells it, so the binding, the panel and a
 * MIDI map all line up key for key and can be read side by side.
 */
export const ViewBindingSchema = z
  .object({
    module: z.string().min(1),
    param: z.string().min(1),
  })
  .strict();

/**
 * The file: control id -> what it drives, or `null` for one that is NAMED and not wired yet.
 *
 * Keyed by the control, so a control drives at most ONE param — two targets on one fader is a
 * thing you cannot see going wrong. The reverse is allowed and useful: two controls may name
 * the same module and param, and both move it.
 *
 * **`null` is a real value**, and it is what a scaffolded surface is made of: every component the
 * desk has, listed, each waiting for a module. Absent and null mean the same thing to everything
 * downstream — `unmappedControls` reports both, because both are unwired — and the difference is
 * for the person reading the file: a key that is there tells you the component exists and what it
 * is called, which is precisely what you need to fill it in. Without it a skeleton could only be
 * comments, and a comment is not something a parser will ever tell you that you got wrong.
 *
 * The control ids are NOT validated here. They are the app's vocabulary — m9's desk knows what
 * a `crossfade` is and `@studio/song` does not — so an unknown id is reported by whoever draws
 * the panel, against the list it actually has. A schema that guessed would go stale the day a
 * control is added.
 */
export const MixViewSchema = z.record(
  z.string().min(1),
  ViewBindingSchema.nullable(),
);

export type MixView = z.infer<typeof MixViewSchema>;
