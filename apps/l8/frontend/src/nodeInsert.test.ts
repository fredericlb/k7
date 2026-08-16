// What the graph's `+` types into the command bar, and what the shell runs after it.
//
// It is TWO lines again, and the reason is the vocabulary rather than the plumbing: a `node …`
// verb acts on a node, so `node insert` stopped creating modules (packages/song/docs/nodes.md)
// and the picker's gesture split back into "make it" and "wire it". Only the first reaches the
// bar — the node's NAME is the one thing a person has to supply — so what matters about it is
// its SHAPE: the line has to end in a space, with the name as the last thing typed.
//
// The second is built from what they typed, read back off the line by `chainRefFromCreate`.

import { describe, expect, it } from "vitest";
import {
  chainRefFromCreate,
  createForGraphCommand,
  ensureModuleCommand,
  type PendingInsert,
  wireCommand,
} from "./nodeInsert";

const arrow: PendingInsert = { before: "melody", after: "OUT" };

describe("the line the + pre-writes", () => {
  it("creates the NODE, ending where its name goes", () => {
    // `node new` and not `module new`: the latter stopped making nodes, and a chain names one.
    const line = createForGraphCommand("audio", "adt");
    expect(line).toBe("node new audio/adt ");
    // The trailing space is load-bearing: it is where the cursor lands.
    expect(line.endsWith(" ")).toBe(true);
    // Three tokens written; the node name the user types becomes the fourth and last.
    expect(line.trim().split(/\s+/)).toHaveLength(3);
  });

  it("is the same line whichever kind was picked — the ref is not on it", () => {
    expect(createForGraphCommand("audio", "echo")).toBe("node new audio/echo ");
  });
});

describe("the line that has to run BEFORE it", () => {
  it("writes the local folder for a CATALOGUE pick, inheriting the ref", () => {
    // `node new` instances a module that exists; a catalogue pick has no folder here yet.
    expect(ensureModuleCommand("audio", "adt", "@engine/audio/delay/adt")).toBe(
      "module new audio/adt @engine/audio/delay/adt",
    );
  });

  it("is nothing for a module this project already has", () => {
    // The common case, and it stays ONE command.
    expect(ensureModuleCommand("audio", "echo")).toBeNull();
  });
});

describe("the line the shell runs after it", () => {
  it("splices into the arrow when there was one, at the click's point", () => {
    expect(wireCommand("adt1", arrow, { x: 300.4, y: 140.6 })).toBe(
      "node insert melody OUT adt1 300,141",
    );
  });

  it("only PINS it when the pick was made on bare canvas", () => {
    // `node new` already put it in the graph, so all that is left is where it sits. `node
    // position` takes x and y as separate words, unlike the spawn token's comma pair.
    expect(wireCommand("adt1", null, { x: 12, y: 8 })).toBe(
      "node position adt1 12 8",
    );
  });

  it("says nothing at all for a bare-canvas pick with no point", () => {
    // Nothing to place and nothing to pin: the layout answers, which is the right answer.
    expect(wireCommand("adt1", null)).toBeNull();
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
  // A node is named by its FILE alone, so this answers that name and nothing about the module
  // behind it — the old `module:node` key would name a node nothing answers to.
  it("takes the node from a `node new` line", () => {
    expect(chainRefFromCreate("node new audio/adt a1")).toBe("a1");
  });

  it("answers null for a `module new` — it makes no node to wire", () => {
    // It used to take a trailing node name and make one, which is why this read it too. A
    // module is not something a chain names, so there is nothing here for the shell to wire.
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
