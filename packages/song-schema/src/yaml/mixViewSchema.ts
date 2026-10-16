// mixViewSchema.ts — `views/mix.yaml`'s shape, in Zod: which control of an app's panel drives
// which module param. Keyed by the CONTROL, because the file is about a desk.
// Full rationale: docs/viewBindings.md.

import { z } from "zod";

/** A module the CHAINS file names, a param as a widget binds it, and which way it reads (docs/deskFiles.md). */
const TargetSchema = z
  .object({
    module: z.string().min(1),
    param: z.string().min(1),
    /** MIRROR the control in its own range before writing — what makes two fades a crossfader. */
    invert: z.boolean().optional(),
  })
  .strict();

/** What one control drives: a target, and at most one SECOND — see packages/song/docs/setProject.md. */
const ViewBindingSchema = TargetSchema.extend({
  also: TargetSchema.optional(),
}).strict();

/** The file: control id -> what it drives, `null` being a REAL value for one not wired yet (docs/deskFiles.md). */
export const MixViewSchema = z.record(
  z.string().min(1),
  ViewBindingSchema.nullable(),
);

export type MixView = z.infer<typeof MixViewSchema>;
