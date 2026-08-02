// chainsSchema.ts — chains.yaml's shape, in Zod. The file declares SEGMENTS, not
// chains: each track and each module says where its signal goes next, and the chains
// are derived by following the arrows (see chainsGraph.ts).

import { z } from "zod";

/** Where one node's signal goes — module instance names, or an io sink like `OUT`. Empty == unwired. */
export const DestsSchema = z.array(z.string().min(1));

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
