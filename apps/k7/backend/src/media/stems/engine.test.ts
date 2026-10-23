// engine.test.ts — a cut goes to the best-rated engine the caller may hand its song: its own, the server's, or one
// it is driving; never one merely shared with it, and never one no jobs channel reaches.

import type { EngineMount } from "@studio/engine-registry";
import { describe, expect, it } from "vitest";
import { bestCutter, mayCut } from "./engine.ts";

interface Row {
  id: string;
  score?: number;
  owner?: string;
  shared?: string[];
  tunnel?: boolean;
  claimedBy?: string;
}

/** A registry and a tunnel hub holding `rows`, with `srv` the render machine. */
function mount(rows: Row[]): EngineMount {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    registry: {
      list: () =>
        rows.map((r) => ({
          id: r.id,
          performance: r.score === undefined ? undefined : { score: r.score },
        })),
      get: (id: string) => (byId.has(id) ? { id } : undefined),
      holds: (id: string, h: string) => byId.get(id)?.claimedBy === h,
      onThisMachine: () => false,
      owners: {
        get: (id: string) => {
          const r = byId.get(id);
          return r?.owner
            ? {
                owner: r.owner,
                shared: r.shared ?? [],
                everyone: false,
                since: 0,
              }
            : undefined;
        },
      },
    },
    tunnels: {
      has: (id: string) => byId.get(id)?.tunnel !== false,
      isRenderer: (id: string) => id === "srv",
    },
  } as unknown as EngineMount;
}

describe("the engine a cut runs on", () => {
  it("takes the best-rated engine the caller owns or the server's", () => {
    const m = mount([
      { id: "srv", score: 900 },
      { id: "mine", score: 1400, owner: "ann@x" },
      { id: "slow", score: 300, owner: "ann@x" },
    ]);
    expect(bestCutter(m, "ann@x")).toBe("mine");
    expect(bestCutter(m, "bob@x")).toBe("srv");
  });

  it("skips an engine only shared with the caller, unless the caller drives it", () => {
    const shared = {
      id: "lent",
      score: 2000,
      owner: "cat@x",
      shared: ["ann@x"],
    };
    expect(
      bestCutter(mount([shared, { id: "srv", score: 900 }]), "ann@x"),
    ).toBe("srv");
    const driven = mount([{ ...shared, claimedBy: "ann@x" }]);
    expect(bestCutter(driven, "ann@x")).toBe("lent");
    expect(mayCut(mount([shared]), "lent", "ann@x")).toBe(false);
  });

  it("skips one no jobs channel reaches, ranks an unrated one last, and answers null when none is left", () => {
    const m = mount([
      { id: "srv" },
      { id: "mine", score: 2000, owner: "ann@x", tunnel: false },
      { id: "rated", score: 500, owner: "ann@x" },
    ]);
    expect(bestCutter(m, "ann@x")).toBe("rated");
    expect(
      bestCutter(mount([{ id: "e", owner: "cat@x" }]), "ann@x"),
    ).toBeNull();
  });
});
