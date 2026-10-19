// `input(n)` — reading a module's SECOND input port from a graph. The port index is the whole contract between
// the two documents: the graph is generated JSON the engine reads with no module.k7x in sight, so position is
// the only fact both sides can hold on their own. See packages/song/docs/ports.md.

import { describe, expect, it } from "vitest";
import { autoWah } from "./autowah";
import { echo } from "./echo";
import { flanger } from "./flanger";
import { graph } from "./index";

describe("input(n)", () => {
  it("names the port on the node, so the engine knows which pair to read", () => {
    const g = graph((b) => b.output(b.aadd(b.input(), b.input(1))));
    expect(g.nodes[0]).toEqual({ type: "ain", out: "n0" });
    expect(g.nodes[1]).toEqual({ type: "ain", port: 1, out: "n1" });
  });

  it("leaves the first port unwritten, so no existing graph moves", () => {
    // A stray `port: 0` would be a diff in three committed artifacts for a default that changed nothing.
    for (const g of [autoWah(), echo(), flanger()])
      for (const n of g.nodes)
        if (n.type === "ain") expect(n).not.toHaveProperty("port");
  });
});
