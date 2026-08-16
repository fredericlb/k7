// chainsSchema.ts — graph.yaml's shape, in Zod. The file declares SEGMENTS, not
// chains: each module says where its signal goes next, and the chains are derived by
// following the arrows (see chainsGraph.ts). ONE map, because a lane is a module too now
// (docs/trackModules.md) — the `tracks:` half is gone, and with it the rule that a name
// could not be in both.

import { z } from "zod";

/**
 * The project's graph file, by name.
 *
 * `graph.yaml` and not `chains.yaml`: what it holds is the whole TOPOLOGY — which nodes exist,
 * what feeds what, which are silenced, and where each one sits. Chains are DERIVED from its
 * `modules:` map (chainsGraph.ts), so naming the file after one of the things read out of it
 * had it wearing the name of its own output. Positions live here for the same reason: where a
 * node sits is a fact about the graph, not about the node.
 *
 * `.yaml` like every other file in a project. The resolver takes `.yml` too
 * (yaml/moduleIO.ts's EXTS), so a hand-written one still reads; this is what gets WRITTEN.
 */
export const GRAPH_FILE = "graph.yaml";
/** The base the resolver looks up — matches `graph.yaml`, and a `graph.yml` written by hand. */
export const GRAPH_BASE = "graph";

/**
 * Where one node's signal goes — module node names, or an io sink like `OUT`. Empty == unwired.
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

export const GraphFileSchema = z
  .object({
    // Each module's next hop(s) — LANES INCLUDED, since a lane is where a run starts and
    // nothing else about it is different. A key with `[]` is a node in the graph that is
    // wired to nothing yet, which is how a module exists before it is placed.
    modules: z.record(z.string().min(1), DestsSchema).optional(),
    // Modules the signal passes through untouched. A flat list, so a bypass is one name
    // appearing or disappearing — and since a module is named ONCE in this file, there is
    // only ever one thing to toggle.
    //
    // On a LANE it reads as "produces nothing" rather than "passes through": a source has no
    // input to pass through. That is what a lane's mute is, and it is why mute stopped being
    // a field on the lane — one state, one place.
    bypassed: z.array(z.string().min(1)).optional(),
    // Where a node SITS on the graph, world px — written when someone drags its header, absent
    // for every node the layout still places (dagre lays out only what has no entry here).
    // Cosmetic on purpose: nothing about the signal reads it, so a file without it is the same
    // song — which is why it is a sibling of `modules:` and not a field inside it.
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
