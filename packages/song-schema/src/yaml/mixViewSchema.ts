// mixViewSchema.ts — `views/mix.yaml`'s shape, in Zod: which control of an app's panel drives
// which module param. Keyed by the CONTROL, because the file is about a desk.
// Full rationale: docs/viewBindings.md.

import { z } from "zod";

/** What one control drives: a module the CHAINS file names, and a param as a widget binds it (docs/deskFiles.md). */
export const ViewBindingSchema = z
  .object({
    module: z.string().min(1),
    param: z.string().min(1),
  })
  .strict();

/** The file: control id -> what it drives, `null` being a REAL value for one not wired yet (docs/deskFiles.md). */
export const MixViewSchema = z.record(
  z.string().min(1),
  ViewBindingSchema.nullable(),
);

export type MixView = z.infer<typeof MixViewSchema>;
