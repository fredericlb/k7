// chainsSchema.ts — chains.yaml's shape, in Zod. The file declares SEGMENTS, not
// chains: each track and each module says where its signal goes next, and the chains
// are derived by following the arrows (see chainsGraph.ts).

import { z } from "zod";

/**
 * Where one node's signal goes — module instance names, or an io sink like `OUT`. Empty == unwired.
 *
 * A destination may name a PORT on its target: `crossfade#b` feeds the input called `b`. Bare, it
 * feeds the FIRST input, which is what every chains file written so far says and what a
 * one-input module means. See `@studio/song`'s docs/ports.md.
 *
 * The port is not validated here — this schema knows nothing about modules, and whether `b`
 * exists is a question for `validate()`, which has the module map. What IS refused is a ref that
 * is all separator (`#b`, `x#`): those are typos with no reading, and letting them through would
 * make the node name empty.
 */
export const DestsSchema = z.array(
  z
    .string()
    .min(1)
    .refine((s) => !s.startsWith("#") && !s.endsWith("#"), {
      message:
        "a port ref is `<module>#<port>` — neither half may be empty (see docs/ports.md)",
    }),
);

export const ChainsFileSchema = z
  .object({
    // Each track's first hop. A track absent from here feeds nothing.
    tracks: z.record(z.string().min(1), DestsSchema).optional(),
    // Each module's next hop(s). A key with `[]` is a node in the graph that is wired
    // to nothing yet — which is how a module exists before it is placed.
    modules: z.record(z.string().min(1), DestsSchema).optional(),
    // Modules the signal passes through untouched. A flat list, so a bypass is one
    // name appearing or disappearing — and since a module is named ONCE in this file,
    // there is only ever one thing to toggle.
    bypassed: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type Dests = z.infer<typeof DestsSchema>;
export type ChainsFile = z.infer<typeof ChainsFileSchema>;
