// What the graph's `+` runs, and what the shell runs after it.
//
// ONE creating line (`node new`, which now scaffolds a catalogue pick's folder from its ref),
// then the WIRED half on an arrow: a `node …` verb acts on a node, and wiring is a verb of its own.
//
// Neither reaches the command bar — the name is derived from the arrow clicked. The trailing
// space `createForGraphCommand` leaves is load-bearing: it is where the name lands, and the bar
// opens on it when there is no catalogue to pick from. See packages/song/docs/nodes.md.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  chainRefFromCreate,
  createForGraphCommand,
  laneOfArrow,
  nodeNameFor,
  nodeNewRefArg,
  type PendingInsert,
  wireCommand,
} from "./nodeInsert";

const arrow: PendingInsert = { before: "melody", after: "OUT" };

describe("the line the + builds", () => {
  it("creates the NODE, ending where its name goes", () => {
    // `node new` and not `module new`: the latter makes no node, and a chain names one.
    const line = createForGraphCommand("audio", "adt");
    expect(line).toBe("node new audio/adt ");
    // The trailing space is load-bearing: it is the join the name lands on, and where the cursor sits on the one path that opens the bar.
    expect(line.endsWith(" ")).toBe(true);
    // Three tokens written; the derived name becomes the fourth and last.
    expect(line.trim().split(/\s+/)).toHaveLength(3);
  });

  it("is the same line whichever kind was picked — the ref is not on it", () => {
    expect(createForGraphCommand("audio", "echo")).toBe("node new audio/echo ");
  });
});

describe("the catalogue ref that rides ON it", () => {
  it("goes between the name and the spawn token, so the verb scaffolds the folder itself", () => {
    expect(
      createForGraphCommand("audio", "adt") +
        "a1" +
        nodeNewRefArg("@engine/audio/delay/adt") +
        " 120,80",
    ).toBe("node new audio/adt a1 @engine/audio/delay/adt 120,80");
  });

  it("is nothing for a module this project already has", () => {
    // The common case, and the line is untouched.
    expect(nodeNewRefArg(undefined)).toBe("");
  });

  it("leaves the node name readable through the ref", () => {
    // `chainRefFromCreate` skips slash-bearing tokens — a node name never carries one.
    expect(
      chainRefFromCreate("node new audio/adt a1 @engine/audio/delay/adt"),
    ).toBe("a1");
  });
});

describe("the line the shell runs after it", () => {
  it("splices into the arrow when there was one, at the click's point", () => {
    expect(wireCommand("adt1", arrow, { x: 300.4, y: 140.6 })).toBe(
      "node insert melody OUT adt1 300,141",
    );
  });

  it("only PINS it when the pick was made on bare canvas", () => {
    // `node new` already put it in the graph, so all that is left is where it sits — x and y as separate words, not the spawn token's pair.
    expect(wireCommand("adt1", null, { x: 12, y: 8 })).toBe(
      "graph move adt1 12 8",
    );
  });

  it("says nothing at all for a bare-canvas pick with no point", () => {
    // Nothing to place and nothing to pin: the layout answers, which is the right answer.
    expect(wireCommand("adt1", null)).toBeNull();
    // A bottom `+` stacks the new node under the card, wherever the click was.
    expect(
      wireCommand(
        "adt1",
        { before: "amp", after: "amp", stack: true },
        { x: 1, y: 2 },
      ),
    ).toBe("node stack amp adt1");
  });

  it("leaves the position out of a splice when the pick carried none", () => {
    expect(wireCommand("adt1", arrow)).toBe("node insert melody OUT adt1");
  });

  it("carries the arrow through verbatim — the seam is resolved server-side", () => {
    expect(
      wireCommand("wah1", { before: "neural-amp-modeler", after: "OUT" }),
    ).toContain("neural-amp-modeler OUT");
  });
});

describe("reading the node's name back off what was typed", () => {
  // A node is named by its FILE alone, so this answers that name and nothing about the module behind it.
  it("takes the node from a `node new` line", () => {
    expect(chainRefFromCreate("node new audio/adt a1")).toBe("a1");
  });

  it("answers null for a `module new` — it makes no node to wire", () => {
    // A module is not something a chain names, so `module new` takes no trailing node name and leaves nothing to wire.
    expect(chainRefFromCreate("module new audio/adt")).toBeNull();
    expect(
      chainRefFromCreate("module new audio/adt @engine/audio/delay/adt"),
    ).toBeNull();
  });

  it("answers null for a line that creates nothing", () => {
    // Which is what stops the shell wiring something after an unrelated command.
    expect(chainRefFromCreate("node insert gtr amp adt1")).toBeNull();
    expect(chainRefFromCreate("node new adt")).toBeNull(); // not <category>/<name>
  });
});

// --- naming the node the pick will create ------------------------------------------

// The one thing that must be decided HERE: the lane is read off the arrow, and the arrow means nothing without the chains around it.

const g = (
  chains: WebGraph["chains"],
  rest: Partial<WebGraph> = {},
): WebGraph =>
  ({ chains, tracks: Object.keys(chains), warnings: [], ...rest }) as WebGraph;

const step = (module: string) => ({ module });
const OUT = [{ to: "OUT", gain: 1 }];

describe("which lane an arrow is on", () => {
  const graph = g({
    "vo.jo": { from: "vo.jo", use: [step("amp"), step("eq")], out: OUT },
    "da.main": { from: "da.main", use: [step("comp")], out: OUT },
  });

  it("takes the chain that IS the arrow's upstream end — a lane feeds its own run", () => {
    expect(laneOfArrow(graph, "vo.jo")).toBe("vo.jo");
  });

  it("takes the chain that PLAYS it, for an arrow further down the run", () => {
    expect(laneOfArrow(graph, "amp")).toBe("vo.jo");
    expect(laneOfArrow(graph, "eq")).toBe("vo.jo");
    expect(laneOfArrow(graph, "comp")).toBe("da.main");
  });

  it("ignores a port — it says nothing about which run this is", () => {
    expect(laneOfArrow(graph, "amp#b")).toBe("vo.jo");
    expect(laneOfArrow(graph, "vo.jo#midi")).toBe("vo.jo");
  });

  it("answers null on the bare canvas, and for a node in no chain", () => {
    expect(laneOfArrow(graph, null)).toBeNull();
    expect(laneOfArrow(graph, "")).toBeNull();
    expect(laneOfArrow(graph, "stranger")).toBeNull();
  });
});

describe("what the picked module lands called", () => {
  const graph = g({
    "vo.jo": { from: "vo.jo", use: [step("amp")], out: OUT },
  });

  it("is <lane>_<module>_<n>, with the lane cleaned", () => {
    expect(nodeNameFor(graph, "reverb", "amp")).toBe("vo_jo_reverb_1");
  });

  it("drops the lane on the bare canvas", () => {
    expect(nodeNameFor(graph, "reverb", null)).toBe("reverb_1");
  });

  it("steps over a name the graph already spells", () => {
    const taken = g({
      "vo.jo": {
        from: "vo.jo",
        use: [step("amp"), step("vo_jo_reverb_1")],
        out: OUT,
      },
    });
    expect(nodeNameFor(taken, "reverb", "amp")).toBe("vo_jo_reverb_2");
  });

  it("counts a curve and a note as taken too — one flat key space", () => {
    const busy = g(
      { "vo.jo": { from: "vo.jo", use: [step("amp")], out: OUT } },
      {
        curves: { vo_jo_reverb_1: {} as never },
        modules: { vo_jo_reverb_2: {} },
      },
    );
    expect(nodeNameFor(busy, "reverb", "amp")).toBe("vo_jo_reverb_3");
  });

  it("completes the line the + runs", () => {
    // The two halves join on the trailing space, which is what that space is FOR now.
    expect(
      createForGraphCommand("audio", "reverb") +
        nodeNameFor(graph, "reverb", "amp"),
    ).toBe("node new audio/reverb vo_jo_reverb_1");
    // …and the shell reads the name straight back off the line, exactly as it does for a typed one.
    expect(
      chainRefFromCreate(
        createForGraphCommand("audio", "reverb") +
          nodeNameFor(graph, "reverb", "amp"),
      ),
    ).toBe("vo_jo_reverb_1");
  });
});
