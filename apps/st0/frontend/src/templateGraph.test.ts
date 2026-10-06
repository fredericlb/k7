// A library chain FILE drawn from its own text: one run from `@in` to `@out`, each card named by its
// id and headed by the module it extends — or the parser's reason, never a half-drawn graph.

import { describe, expect, it } from "vitest";
import { templateGraph } from "./templateGraph";

describe("templateGraph", () => {
  it("draws the steps as one chain from @in to @out", () => {
    const r = templateGraph(
      "@st0/x",
      'steps:\n  - { id: a, extends: "@st0/audio/eq" }\n  - { id: b, extends: "@st0/audio/comp", bypass: true }\n  - to: [ { chain: "@out" } ]\n',
    );
    if (!("graph" in r)) throw new Error(r.error);
    expect(r.graph.chains["@st0/x"]).toEqual({
      from: "@in",
      use: [
        { module: "a", uses: "@st0/audio/eq" },
        { module: "b", uses: "@st0/audio/comp", enabled: false },
      ],
      out: [{ to: "@out", gain: 1 }],
    });
  });

  it("answers the reason a text does not read", () => {
    expect(templateGraph("x", "steps: [ 3 ]\n")).toHaveProperty("error");
  });
});
