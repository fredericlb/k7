// The crossfade — the library's worked example of a TWO-INPUT module.
//
// What can go silently wrong here is the port index. It is the only thing tying the graph to the module file
// that declares the ports (module.yaml's `inputs:`), and the two never meet: the engine reads the graph with
// no module in sight and counts `port` to decide how many channels to ask Tracktion for. Get it wrong and the
// module still loads, still plays its first input, and the second one is silence — which is exactly what a
// crossfade pushed to one side sounds like when it is working.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { crossfade } from "./crossfade";
import type { GraphJson } from "./index";

const here = dirname(fileURLToPath(import.meta.url));

describe("the crossfade graph", () => {
  const g = crossfade();

  it("has the one control a crossfade has", () => {
    expect(g.params.map((p) => p.name)).toEqual(["Mix"]);
    // Centred, so a module dropped into a chain and left alone passes both sides rather than one.
    expect(g.params[0].default).toBe(0.5);
  });

  it("reads two ports, and names the second one", () => {
    const ports = g.nodes
      .filter((n) => n.type === "ain")
      .map((n) => n.port ?? 0);
    expect(ports).toEqual([0, 1]);
  });

  it("weights the two sides against each other, not each against the dry", () => {
    // `mix` (the node) blends the graph's output with what came IN on port 0, which for a crossfade would
    // fold the first side in twice. The blend has to be arithmetic between the two wires instead.
    expect(g.nodes.some((n) => n.type === "mix")).toBe(false);
    const [subNode] = g.nodes.filter((n) => n.type === "sub");
    expect(subNode.in).toEqual([1, "Mix"]); // 1 − Mix on one side, Mix on the other
  });

  it("is what graphs/crossfade.json holds — the artifact that actually runs", () => {
    const committed = JSON.parse(
      readFileSync(join(here, "..", "graphs", "crossfade.json"), "utf8"),
    ) as GraphJson;
    expect(g).toEqual(committed);
  });

  it("matches the demo song's module, which carries its own copy of the source", () => {
    // A module is a FOLDER you can copy: it holds its `jsdsp.ts` rather than pointing at this
    // library, so the crossfade exists twice on purpose. Two copies of one thing is a drift
    // waiting to happen — the same reason autowah.test.ts reads the engine's pasted fallback —
    // so the module's committed graph is compared here rather than trusted.
    const demo = JSON.parse(
      readFileSync(
        join(
          here,
          "..",
          "..",
          "..",
          "engine",
          "capot",
          "songs",
          "crossfade-demo.st0",
          "modules",
          "audio",
          "crossfade",
          "jsdsp.json",
        ),
        "utf8",
      ),
    ) as GraphJson;
    expect(g).toEqual(demo);
  });

  it("matches the copy in `modules/` — the authored article", () => {
    // A third copy, for the third reason a module folder is self-contained: this one is the
    // module as it is AUTHORED, `modules/audio/utility/crossfade/`, which is what somebody
    // copies into their library repository (`docs/catalogue.md`). The demo above is a demo;
    // this one is what a set naming `@st0/audio/utility/crossfade` ends up running.
    //
    // It used to be "the one every new library is seeded with", and nothing seeds any more —
    // the account's library repository is the reference. What the test pins is unchanged: the
    // folder's compiled graph against this package's function, so the two cannot drift.
    const authored = JSON.parse(
      readFileSync(
        join(
          here,
          "..",
          "modules",
          "audio",
          "utility",
          "crossfade",
          "jsdsp.json",
        ),
        "utf8",
      ),
    ) as GraphJson;
    expect(g).toEqual(authored);
  });
});
