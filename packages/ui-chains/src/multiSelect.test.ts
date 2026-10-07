// Shift+click selection, and the nodes a control on one of them drives: all or none.

import { describe, expect, it } from "vitest";
import type { GraphNode } from "./graph";
import { linkedNodes, toggleSelection } from "./multiSelect";

const node = (module: string, over: Partial<GraphNode> = {}): GraphNode =>
  ({
    id: `mod:${module}`,
    label: module,
    kind: "module",
    module,
    uses: "@st0/audio/amp",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    dim: false,
    ...over,
  }) as GraphNode;

describe("toggleSelection", () => {
  it("grows from the single selection, and a second Shift+click takes a node back out", () => {
    const two = toggleSelection(new Set(), "amp_1", "amp_2");
    expect([...two]).toEqual(["amp_1", "amp_2"]);
    expect([...toggleSelection(two, "amp_1", "amp_2")]).toEqual(["amp_1"]);
    expect([...toggleSelection(new Set(), null, "amp_2")]).toEqual(["amp_2"]);
  });
});

describe("linkedNodes", () => {
  const a = node("amp_1");
  const b = node("amp_2");
  const c = node("amp_3");
  const sel = new Set(["amp_1", "amp_2", "amp_3"]);

  it("links every other selected node when all are one ref on one engine", () => {
    expect(linkedNodes([a, b, c], sel, a)).toEqual([b, c]);
  });

  it("links nothing for a mixed selection — another ref, another engine", () => {
    const other = node("amp_3", { uses: "@st0/audio/drive" });
    expect(linkedNodes([a, b, other], sel, a)).toEqual([]);
    const engine = node("amp_3", { engine: "fast" });
    expect(linkedNodes([a, b, engine], sel, a)).toEqual([]);
  });

  it("links nothing from a node outside the selection, nor with one node selected", () => {
    expect(linkedNodes([a, b, c], sel, node("amp_9"))).toEqual([]);
    expect(linkedNodes([a, b], new Set(["amp_1"]), a)).toEqual([]);
  });

  it("leaves a baked node out, and the rest still move", () => {
    const frozen = node("amp_3", { frozen: "at" });
    expect(linkedNodes([a, b, frozen], sel, a)).toEqual([b]);
  });
});
