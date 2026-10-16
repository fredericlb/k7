// Shift+click selection, and the nodes a control on one of them drives: all or none.

import { describe, expect, it } from "vitest";
import type { GraphNode } from "./graph";
import {
  linkedNodes,
  linkedValue,
  nodesInBox,
  toggleSelection,
} from "./multiSelect";

const node = (module: string, over: Partial<GraphNode> = {}): GraphNode =>
  ({
    id: `mod:${module}`,
    label: module,
    kind: "module",
    module,
    uses: "@k7-core/audio/amp",
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
    const other = node("amp_3", { uses: "@k7-core/audio/drive" });
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

describe("linkedValue", () => {
  const knob = {
    type: "knob",
    col: 0,
    row: 0,
    bind: "Drive",
    min: 0,
    max: 10,
  } as const;

  it("moves a linked knob by the same TRAVEL from its own start, not to the same value", () => {
    // The knob in hand goes 0.2 → 0.5 of its throw; one that stood at 0.6 lands at 0.9, i.e. 9.
    expect(linkedValue(knob, 0.6, 0.2, 0.5)).toBeCloseTo(9);
  });

  it("stops at the end of its own throw", () => {
    expect(linkedValue(knob, 0.9, 0.2, 0.5)).toBe(10);
    expect(linkedValue(knob, 0.1, 0.5, 0.2)).toBe(0);
  });
});

describe("nodesInBox", () => {
  const at = (module: string, x: number, kind: GraphNode["kind"] = "module") =>
    node(module, { x, y: 0, w: 100, h: 50, kind });

  it("catches every module card the rectangle touches, dragged in either direction", () => {
    const nodes = [at("a", 0), at("b", 200), at("c", 400)];
    expect(nodesInBox(nodes, { x0: 150, y0: 10, x1: 250, y1: 20 })).toEqual([
      "b",
    ]);
    expect(nodesInBox(nodes, { x0: 450, y0: 40, x1: 50, y1: -5 })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("leaves out what is not a module card — a lane, a sink", () => {
    const nodes = [at("a", 0), at("lane", 0, "track"), at("out", 0, "sink")];
    expect(nodesInBox(nodes, { x0: 0, y0: 0, x1: 50, y1: 50 })).toEqual(["a"]);
  });
});
