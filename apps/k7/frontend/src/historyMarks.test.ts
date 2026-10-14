import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { historyMarks, isEmptyMark, nodeMarked } from "./historyMarks";

const graph = {
  chains: {
    "be.bass": {
      from: "be.bass",
      use: [{ module: "5ee626e6" }, { module: "fb4235d5" }],
      out: [],
    },
  },
  tracks: ["be.bass"],
  warnings: [],
} as unknown as WebGraph;

describe("historyMarks — what a History row lights", () => {
  it("lights a lane for its track file, and a clip for its sequence or audio file", () => {
    const m = historyMarks([
      "tracks/da.main.yaml",
      "sequences/irrupt_kit_5_1.yaml",
      "clips/take 3.wav",
    ]);
    expect([...m.lanes]).toEqual(["da.main"]);
    expect([...m.clips].sort()).toEqual(["irrupt_kit_5_1", "take 3"]);
  });

  it("lights only the node a journal label names, inside the chain it changed", () => {
    const m = historyMarks(
      ["chains/be.bass.yaml"],
      'node param "5ee626e6" "model" "@k7-core/x.nam"',
      graph,
    );
    expect([...m.modules]).toEqual(["5ee626e6"]);
    expect(m.chains.size).toBe(0);
  });

  it("lights the whole chain when nothing names a node — a commit, say", () => {
    const m = historyMarks(["chains/be.bass.yaml"], "sync", graph);
    expect([...m.chains]).toEqual(["be.bass"]);
  });

  it("lights nothing for project-level files", () => {
    expect(isEmptyMark(historyMarks(["project.yaml", "layout.yaml"]))).toBe(
      true,
    );
  });
});

describe("nodeMarked", () => {
  const m = historyMarks(["tracks/da.main.yaml", "chains/be.bass.yaml"]);
  it("lights a lane's own card, and every card of a lit chain", () => {
    expect(nodeMarked(m, { kind: "track", module: "da.main" })).toBe(true);
    expect(
      nodeMarked(m, { kind: "module", module: "x", chain: "be.bass" }),
    ).toBe(true);
    expect(
      nodeMarked(m, { kind: "module", module: "y", chains: ["a", "be.bass"] }),
    ).toBe(true);
    expect(nodeMarked(m, { kind: "module", module: "z", chain: "other" })).toBe(
      false,
    );
  });
});
