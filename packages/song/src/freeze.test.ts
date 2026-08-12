// Freezing at a MODULE. What is pinned here is the UPSTREAM set — the definition of the feature —
// and the one condition that makes a render honest. See docs/freeze.md.

import { describe, expect, it } from "vitest";
import {
  activeFreezePlans,
  freezeBlockedBy,
  freezePlans,
  upstreamOf,
} from "./freeze";
import type { Chain } from "./graph";

const chain = (
  from: string | undefined,
  use: string[],
  out: string[] = ["OUT"],
): Chain => ({
  ...(from ? { from } : {}),
  use: use.map((module) => ({ module })),
  out: out.map((to) => ({ to, gain: 1 })),
});

// gtr -> amp -> cab -> OUT
const RUN: Record<string, Chain> = { gtr: chain("gtr", ["amp", "cab"]) };

// Two lanes meeting at a bus, the bus through a reverb to OUT.
const BUS: Record<string, Chain> = {
  gtr: chain("gtr", [], ["verb"]),
  keys: chain("keys", [], ["verb"]),
  verb: chain(undefined, ["verb", "plate"]),
};

describe("what is upstream", () => {
  it("includes the module ITSELF — the render is taken at its output", () => {
    // Freezing the amp gives you the amped sound, not the sound going into it. The whole
    // definition of the feature is in this one assertion.
    expect([...upstreamOf(RUN, "amp")].sort()).toEqual(["amp", "gtr"]);
  });

  it("stops there: what is DOWNSTREAM stays live", () => {
    expect(upstreamOf(RUN, "amp").has("cab")).toBe(false);
    // …and freezing the last one takes the whole run.
    expect([...upstreamOf(RUN, "cab")].sort()).toEqual(["amp", "cab", "gtr"]);
  });

  it("takes EVERY lane that meets at a bus", () => {
    expect([...upstreamOf(BUS, "verb")].sort()).toEqual([
      "gtr",
      "keys",
      "verb",
    ]);
    expect([...upstreamOf(BUS, "plate")].sort()).toEqual([
      "gtr",
      "keys",
      "plate",
      "verb",
    ]);
  });

  it("follows a SIDE input, which is signal arriving like any other", () => {
    const g: Record<string, Chain> = {
      deckA: {
        from: "deckA",
        use: [{ module: "crossfade", in: ["deckB"] }],
        out: [{ to: "OUT", gain: 1 }],
      },
      deckB: chain("deckB", [], ["crossfade#b"]),
    };
    expect([...upstreamOf(g, "crossfade")].sort()).toEqual([
      "crossfade",
      "deckA",
      "deckB",
    ]);
  });

  it("stops at a cycle instead of looping on it", () => {
    const g: Record<string, Chain> = {
      a: chain(undefined, ["a", "b"], ["a"]),
    };
    expect(() => upstreamOf(g, "b")).not.toThrow();
    expect(upstreamOf(g, "b").has("a")).toBe(true);
  });

  it("takes a lane's own run when the freeze point is the lane's last module", () => {
    // A lane feeding a bus: freezing the bus takes the lane AND what the lane runs first.
    const g: Record<string, Chain> = {
      gtr: chain("gtr", ["amp"], ["verb"]),
      verb: chain(undefined, ["verb"]),
    };
    expect([...upstreamOf(g, "verb")].sort()).toEqual(["amp", "gtr", "verb"]);
  });
});

describe("when it is refused", () => {
  it("refuses when something upstream ALSO feeds outside the set", () => {
    // `gtr` goes to the amp and, dry, to the master. Its signal would be in the render and still
    // playing — heard twice, at a level nothing on screen explains.
    const g: Record<string, Chain> = {
      gtr: chain("gtr", [], ["amp", "OUT"]),
      amp: chain(undefined, ["amp"]),
    };
    const why = freezeBlockedBy(g, "amp");
    expect(why).toContain("gtr");
    expect(why).toContain("also feeds");
  });

  it("names the way out rather than only the problem", () => {
    const g: Record<string, Chain> = {
      gtr: chain("gtr", [], ["amp", "OUT"]),
      amp: chain(undefined, ["amp"]),
    };
    expect(freezeBlockedBy(g, "amp")).toContain(
      "Freeze at the point they meet",
    );
  });

  it("allows the module's OWN destinations to leave — that is the point of it", () => {
    expect(freezeBlockedBy(RUN, "amp")).toBeNull();
    expect(freezeBlockedBy(BUS, "verb")).toBeNull();
  });

  it("allows a lane that feeds two things BOTH inside the set", () => {
    // A split that rejoins: neither branch leaves, so one render still says everything.
    const g: Record<string, Chain> = {
      gtr: chain("gtr", [], ["dry", "wet"]),
      dry: chain(undefined, ["dry"], ["mix"]),
      wet: chain(undefined, ["wet"], ["mix"]),
      mix: chain(undefined, ["mix"]),
    };
    expect(freezeBlockedBy(g, "mix")).toBeNull();
    expect([...upstreamOf(g, "mix")].sort()).toEqual([
      "dry",
      "gtr",
      "mix",
      "wet",
    ]);
  });

  it("says so when the name is in no chain at all", () => {
    expect(freezeBlockedBy(RUN, "ghost")).toContain('no module "ghost"');
  });
});

describe("the plan the compiler follows", () => {
  const isLane = (n: string) => n === "gtr" || n === "keys";

  it("splits the set into lanes that lose their clips and modules that lose their plugins", () => {
    const [plan] = freezePlans(BUS, [["verb", "renders/verb.wav"]], isLane);
    expect(plan.at).toBe("verb");
    expect(plan.render).toBe("renders/verb.wav");
    expect([...plan.lanes].sort()).toEqual(["gtr", "keys"]);
    expect([...plan.modules]).toEqual(["verb"]);
  });

  it("drops a frozen name the chains do not have, rather than planning nothing", () => {
    const at: [string, string][] = [
      ["ghost", "renders/ghost.wav"],
      ["amp", "renders/amp.wav"],
    ];
    expect(freezePlans(RUN, at, isLane).map((p) => p.at)).toEqual(["amp"]);
  });

  it("counts a freeze only once its render is on disk", () => {
    // The compiler and the graph both come through here, so "is this baked?" has ONE answer.
    // A project cloned without its renders plays live rather than failing to open.
    const modules = { amp: { frozen: "renders/amp.wav" }, cab: {} };
    const plans = (there: boolean) =>
      activeFreezePlans(RUN, modules, isLane, () => there);
    expect(plans(true).map((p) => p.at)).toEqual(["amp"]);
    expect(plans(false)).toEqual([]);
    // …and a module that says nothing is not frozen whatever is lying beside it.
    expect(
      activeFreezePlans(RUN, { amp: { frozen: "" } }, isLane, () => true),
    ).toEqual([]);
  });
});
