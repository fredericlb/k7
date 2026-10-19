// A library chain FILE drawn from its own text: one run from `@in` to `@out`, each card named by its
// id and headed by the module it extends — or the parser's reason, never a half-drawn graph.

import { describe, expect, it } from "vitest";
import { templateGraph } from "./templateGraph";

describe("templateGraph", () => {
  it("draws the steps as one chain from @in to @out", () => {
    const r = templateGraph(
      "@k7-core/x",
      [
        "steps([",
        '  id("a").extends("@k7-core/audio/eq"),',
        '  id("b").extends("@k7-core/audio/comp").bypass(true),',
        '  to([chain("@out")]),',
        "])",
        "",
      ].join("\n"),
    );
    if (!("graph" in r)) throw new Error(r.error);
    expect(r.graph.chains["@k7-core/x"]).toEqual({
      from: "@in",
      use: [
        { module: "a", uses: "@k7-core/audio/eq" },
        { module: "b", uses: "@k7-core/audio/comp", enabled: false },
      ],
      out: [{ to: "@out", gain: 1 }],
    });
  });

  it("answers the reason a text does not read", () => {
    expect(templateGraph("x", "steps([3])\n")).toHaveProperty("error");
    // …and a text that does not parse, with the line it stops on.
    const r = templateGraph("x", "steps([\n  id(\n");
    expect(r).toHaveProperty("error");
    expect("error" in r ? r.error : "").toMatch(/^\d+: /);
  });
});
