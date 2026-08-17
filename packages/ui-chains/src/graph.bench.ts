// What laying out a graph costs, at two sizes.
//
// No disk here, and that is the point rather than a shortcut: `buildGraph` takes a `WebGraph`, so
// its cost is the node/edge arithmetic plus dagre — not a compile. Timing it beside a fixture on
// disk would fold the two together and neither number would mean anything.
//
// The sizes match `@studio/song`'s BENCH_SIZES in lane count so the three benches can be read as
// one story; they are spelled here rather than imported because this package deliberately does not
// depend on `song` (it takes `graph-model`, which is the wire, and nothing that reads a folder).

import type { WebGraph } from "@studio/graph-model";
import { bench, describe } from "vitest";
import { buildGraph } from "./graph";

const LANES = { small: 8, large: 64 };

/** N lanes, each running its own synth to OUT — the shape `benchProject` writes to disk. */
function synthGraph(lanes: number): WebGraph {
  const chains: WebGraph["chains"] = {};
  for (let i = 0; i < lanes; i++)
    chains[`lane${i}`] = {
      from: `lane${i}`,
      use: [{ module: `synth${i}`, params: {} }],
      out: [{ to: "OUT", gain: 1 }],
    };
  return {
    chains,
    tracks: Array.from({ length: lanes }, (_, i) => `lane${i}`),
    warnings: [],
  } as unknown as WebGraph;
}

for (const [name, lanes] of Object.entries(LANES)) {
  const graph = synthGraph(lanes);
  describe(`buildGraph — ${name} (${lanes} lanes)`, () => {
    bench("build + lay out", () => {
      buildGraph(graph);
    });
  });
}
