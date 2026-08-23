// chainsSchema.ts — graph.yaml's shape, in Zod. The file declares SEGMENTS, not
// chains: each module says where its signal goes next, and the chains are derived by
// following the arrows (see chainsGraph.ts). ONE map, because a lane is a module too now
// (docs/trackModules.md) — the `tracks:` half is gone, and with it the rule that a name
// could not be in both.

import { z } from "zod";

/** The project's graph file: `graph.yaml`, since what it holds is the whole TOPOLOGY — see docs/graphEdits.md. */
export const GRAPH_FILE = "graph.yaml";
/** The base the resolver looks up — matches `graph.yaml`, and a `graph.yml` written by hand. */
export const GRAPH_BASE = "graph";

// A library CHAIN uses this same name, and IS one of these documents — see docs/graphEdits.md.

/** Where one node's signal goes, `#port` and all, empty meaning unwired — the port is checked by validate(). */
export const DestsSchema = z.array(
  z
    .string()
    .min(1)
    .refine((s) => !s.startsWith("#") && !s.endsWith("#"), {
      message:
        "a port ref is `<module>#<port>` — neither half may be empty (see docs/ports.md)",
    }),
);

export const GraphFileSchema = z
  .object({
    // Each module's next hop(s), LANES INCLUDED; a key with `[]` is a node wired to nothing yet.
    modules: z.record(z.string().min(1), DestsSchema).optional(),
    // Modules the signal passes through untouched, and a LANE's mute — one state, one place (docs/graphEdits.md).
    bypassed: z.array(z.string().min(1)).optional(),
    // Where a node SITS on the graph in world px, cosmetic and absent for whatever dagre still places.
    positions: z
      .record(
        z.string().min(1),
        z.object({ x: z.number(), y: z.number() }).strict(),
      )
      .optional(),
  })
  .strict();

export type Dests = z.infer<typeof DestsSchema>;
export type GraphFile = z.infer<typeof GraphFileSchema>;
