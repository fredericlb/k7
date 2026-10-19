import { K7Document } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  addNode,
  clearNodePositions,
  connectNodes,
  disconnectNodes,
  formatChains,
  insertBetween,
  mergeSegments,
  nodeNames,
  parseGraph,
  removeNode,
  renameNode,
  setModuleEnabled,
  setNodePosition,
} from "./graphFile";

// Every edit here is an edge rewire, and what each has to preserve is in docs/graphEdits.md.

// The canonical form, written out here because it IS the contract — see docs/graphEdits.md.
const AUTHORED = `// The signal graph, as segments.
modules({
  "vo.jo": ["eq_dj:vox"],
  "da.main": ["drum_1"],
  "be.chorus": ["amp:bass"],
  "eq_dj:vox": ["OUT"],
  drum_1: ["OUT"],
  "amp:bass": ["cabinet"],
  cabinet: ["OUT"],
  reverb: ["OUT"],
})
bypassed(["eq_dj:vox"])
`;

/** Run one writer over a text and hand back the text it leaves, plus what the writer answered. */
function edit<T>(
  text: string,
  fn: (doc: ReturnType<K7Document["at"]>) => T,
): { text: string; out: T } {
  const doc = new K7Document(text);
  const out = fn(doc.at([]));
  return { text: doc.toString(), out };
}
const run = (
  text: string,
  fn: (doc: ReturnType<K7Document["at"]>) => unknown,
) => edit(text, fn).text;

const diff = (a: string, b: string): string[] => {
  const before = a.split("\n");
  return b
    .split("\n")
    .map((l, i) => (l === before[i] ? null : `${i + 1}`))
    .filter((x): x is string => x !== null);
};

describe("the model survives the round trip", () => {
  it("reads nodes, destinations and bypass", () => {
    const { value, issues } = parseGraph(AUTHORED);
    expect(issues).toEqual([]);
    // ONE map: a lane and a module are the same kind of node.
    expect(value?.modules?.["vo.jo"]).toEqual(["eq_dj:vox"]);
    expect(value?.modules?.["da.main"]).toEqual(["drum_1"]);
    expect(value?.modules?.["amp:bass"]).toEqual(["cabinet"]);
    expect(value?.bypassed).toEqual(["eq_dj:vox"]);
    expect(nodeNames(AUTHORED)).toContain("amp:bass");
  });

  it("rejects an unknown section, on its line", () => {
    const { issues } = parseGraph(
      'modules({ a: ["b"] })\nbusses({ c: ["d"] })\n',
    );
    expect(issues[0].path).toBe("busses");
    expect(issues[0].line).toBe(2);
  });

  it("reports a syntax error with its line and column", () => {
    const { value, issues } = parseGraph('modules({ a: ["b" })\n');
    expect(value).toBeNull();
    expect(issues[0].line).toBe(1);
    expect(issues[0].message).not.toMatch(/\(\d+:\d+\)$/);
  });

  it("expands runs into segments", () => {
    const { value } = parseGraph('runs([["a", "b", "OUT"]])\n');
    expect(value?.modules).toEqual({ a: ["b"], b: ["OUT"] });
  });

  it("names a runs that does not read", () => {
    const { issues } = parseGraph('runs(["a"])\n');
    expect(issues[0].path).toBe("runs");
    expect(issues[0].line).toBe(1);
  });
});

describe("bypassing a module", () => {
  it("touches exactly one line", () => {
    const after = run(AUTHORED, (d) => setModuleEnabled(d, "drum_1", false));
    expect(diff(AUTHORED, after)).toEqual(["12"]);
    expect(after).toContain('bypassed(["eq_dj:vox", "drum_1"])');
  });

  it("returns the file to what it was when toggled back", () => {
    const off = run(AUTHORED, (d) => setModuleEnabled(d, "drum_1", false));
    expect(run(off, (d) => setModuleEnabled(d, "drum_1", true))).toBe(AUTHORED);
  });

  it("drops the list entirely once it empties", () => {
    // Otherwise an empty `bypassed` sits in every project that never bypassed anything, reading as a setting.
    const on = run(AUTHORED, (d) => setModuleEnabled(d, "eq_dj:vox", true));
    expect(on).not.toContain("bypassed");
    expect(on).toContain("// The signal graph, as segments.");
  });

  it("says which name it couldn't find", () => {
    expect(() =>
      run(AUTHORED, (d) => setModuleEnabled(d, "nope", false)),
    ).toThrow(/no module "nope"/);
  });
});

describe("placing a module with no wiring", () => {
  it("adds it to `modules` with an empty destination list", () => {
    // A node on the graph and wired to nothing is a state of its own — see docs/graphEdits.md.
    const after = run(AUTHORED, (d) => addNode(d, "wah"));
    expect(after).toContain("wah: []");
    expect(parseGraph(after).value?.modules?.wah).toEqual([]);
  });

  it("leaves a node it already knows alone", () => {
    // Re-adding must not be a way to silently unwire something.
    expect(run(AUTHORED, (d) => addNode(d, "cabinet"))).toBe(AUTHORED);
  });

  it("creates the section when the file has none", () => {
    const after = run('bypassed(["x"])\n', (d) => addNode(d, "wah"));
    expect(parseGraph(after).value?.modules?.wah).toEqual([]);
  });
});

describe("pinning a node's position", () => {
  it("writes the pin under `positions`, rounded to whole px", () => {
    const after = run(AUTHORED, (d) =>
      setNodePosition(d, "cabinet", { x: 420.7, y: 179.2 }),
    );
    expect(after).toContain("cabinet: { x: 421, y: 179 }");
    expect(parseGraph(after).value?.positions?.cabinet).toEqual({
      x: 421,
      y: 179,
    });
  });

  it("updates a pin in place — one entry per node, however many drags", () => {
    const once = run(AUTHORED, (d) =>
      setNodePosition(d, "cabinet", { x: 10, y: 10 }),
    );
    const twice = run(once, (d) =>
      setNodePosition(d, "cabinet", { x: 50, y: 60 }),
    );
    expect(twice.match(/cabinet: \{/g)).toHaveLength(1);
    expect(diff(once, twice)).toHaveLength(1);
  });

  it("releasing the last pin drops the whole section", () => {
    const pinned = run(AUTHORED, (d) =>
      setNodePosition(d, "cabinet", { x: 10, y: 10 }),
    );
    expect(run(pinned, (d) => setNodePosition(d, "cabinet", null))).toBe(
      AUTHORED,
    );
  });

  it("clearing hands every node back and leaves no section — `graph organize`'s write", () => {
    const pinned = run(AUTHORED, (d) => {
      setNodePosition(d, "cabinet", { x: 1, y: 2 });
      setNodePosition(d, "reverb", { x: 3, y: 4 });
    });
    expect(run(pinned, clearNodePositions)).toBe(AUTHORED);
    expect(run(AUTHORED, clearNodePositions)).toBe(AUTHORED);
  });

  it("a rename carries the pin, a removal drops it", () => {
    const pinned = run(AUTHORED, (d) =>
      setNodePosition(d, "cabinet", { x: 33, y: 44 }),
    );
    const renamed = run(pinned, (d) => renameNode(d, "cabinet", "cab2"));
    expect(parseGraph(renamed).value?.positions?.cab2).toEqual({
      x: 33,
      y: 44,
    });
    const removed = run(pinned, (d) => removeNode(d, "cabinet"));
    expect(removed).not.toContain("positions");
  });
});

describe("connecting two nodes with a new arrow", () => {
  it("adds the destination without touching what the source already feeds", () => {
    // A patch cable is not a splice: amp:bass keeps cabinet AND gains reverb.
    const after = run(AUTHORED, (d) => connectNodes(d, "amp:bass", "reverb"));
    expect(after).toContain('"amp:bass": ["cabinet", "reverb"]');
    expect(diff(AUTHORED, after)).toHaveLength(1);
  });

  it("creates the key for a source the file never listed", () => {
    // A node can appear only as somebody's destination until its first outgoing cable.
    const after = run('modules({ a: ["b"] })\n', (d) =>
      connectNodes(d, "b", "OUT"),
    );
    expect(parseGraph(after).value?.modules?.b).toEqual(["OUT"]);
  });

  it("carries a #port on either end, spelt as the file spells them", () => {
    const base = 'modules({ split: [], wet: ["OUT"] })\n';
    const after = run(base, (d) => connectNodes(d, "split#b", "wet#in2"));
    expect(parseGraph(after).value?.modules?.["split#b"]).toEqual(["wet#in2"]);
  });

  it("refuses an arrow that is already there", () => {
    expect(() =>
      run(AUTHORED, (d) => connectNodes(d, "cabinet", "OUT")),
    ).toThrow(/already feeds/);
  });
});

describe("pulling one arrow out", () => {
  it("removes exactly that destination, and the round trip leaves no trace", () => {
    const wired = run(AUTHORED, (d) => connectNodes(d, "amp:bass", "reverb"));
    expect(run(wired, (d) => disconnectNodes(d, "amp:bass", "reverb"))).toBe(
      AUTHORED,
    );
  });

  it("a source left feeding nothing KEEPS its key — the module is still placed", () => {
    const after = run(AUTHORED, (d) => disconnectNodes(d, "cabinet", "OUT"));
    expect(parseGraph(after).value?.modules?.cabinet).toEqual([]);
  });

  it("refuses an arrow that is not there, naming what the node does feed", () => {
    expect(() =>
      run(AUTHORED, (d) => disconnectNodes(d, "cabinet", "reverb")),
    ).toThrow(/does not feed 'reverb' \(it feeds: OUT\)/);
  });
});

describe("inserting a module into an arrow", () => {
  it("rewires the two ends and nothing else", () => {
    const after = run(AUTHORED, (d) =>
      insertBetween(d, "amp:bass", "cabinet", "filter"),
    );
    const { value, issues } = parseGraph(after);
    expect(issues).toEqual([]);
    expect(value?.modules?.["amp:bass"]).toEqual(["filter"]);
    expect(value?.modules?.filter).toEqual(["cabinet"]);
    expect(value?.modules?.cabinet).toEqual(["OUT"]);
  });

  it("says so when the two ends aren't an arrow", () => {
    expect(() =>
      run(AUTHORED, (d) => insertBetween(d, "da.main", "cabinet", "x")),
    ).toThrow(/does not feed 'cabinet'/);
  });
});

describe("removing a module", () => {
  it("joins what fed it to what it fed", () => {
    // The gap has to be closed on purpose here, or `be.chorus` feeds a name that is gone.
    const { text, out } = edit(AUTHORED, (d) => removeNode(d, "amp:bass"));
    expect(text).toContain('"be.chorus": ["cabinet"]');
    expect(text).not.toContain("amp:bass");
    expect(out).toEqual(["be.chorus"]);
  });

  it("takes its bypass with it", () => {
    // The next module given that name would otherwise come up silently bypassed.
    const text = run(AUTHORED, (d) => removeNode(d, "eq_dj:vox"));
    expect(text).not.toContain("bypassed");
    expect(text).toContain('"vo.jo": ["OUT"]');
  });

  it("does not list a survivor twice when two branches rejoined through it", () => {
    const forked =
      'modules({ a: ["split"], split: ["verb", "OUT"], verb: ["OUT"] })\n';
    const text = run(forked, (d) => removeNode(d, "verb"));
    expect(parseGraph(text).value?.modules?.split).toEqual(["OUT"]);
  });
});

describe("renaming a module", () => {
  it("moves the name, not the position", () => {
    const { text, out } = edit(AUTHORED, (d) =>
      renameNode(d, "cabinet", "cab:v2"),
    );
    expect(text).toContain('"amp:bass": ["cab:v2"]');
    expect(text).toContain('"cab:v2": ["OUT"]');
    expect(out).toEqual(["amp:bass"]);
    // Still seventh in `modules` — renaming in place is what keeps it off the bottom of the file.
    expect(Object.keys(parseGraph(text).value?.modules ?? {})[6]).toBe(
      "cab:v2",
    );
    expect(diff(AUTHORED, text)).toHaveLength(2);
  });

  it("carries a bypass across", () => {
    const text = run(AUTHORED, (d) => renameNode(d, "eq_dj:vox", "eq:v2"));
    expect(text).toContain('bypassed(["eq:v2"])');
    expect(text).toContain('"vo.jo": ["eq:v2"]');
  });
});

describe("a graph written with runs", () => {
  const RUNS =
    '// lead\nruns([["melody", "lead", "MIX", "OUT"]])\nbypassed([])\n';

  it("keeps the runs through an edit that leaves the segments alone", () => {
    const after = run(RUNS, (d) => setModuleEnabled(d, "lead", false));
    expect(after).toContain('runs([["melody", "lead", "MIX", "OUT"]])');
    expect(parseGraph(after).value?.bypassed).toEqual(["lead"]);
  });

  it("writes the segments in full once an edit changes them", () => {
    const after = run(RUNS, (d) => insertBetween(d, "lead", "MIX", "drive"));
    expect(after).not.toContain("runs(");
    expect(parseGraph(after).value?.modules).toEqual({
      melody: ["lead"],
      lead: ["drive"],
      drive: ["MIX"],
      MIX: ["OUT"],
    });
  });

  it("renames inside the runs, keeping them", () => {
    const { text, out } = edit(RUNS, (d) => renameNode(d, "lead", "solo"));
    expect(text).toBe(
      '// lead\nruns([["melody", "solo", "MIX", "OUT"]])\nbypassed([])\n',
    );
    expect(out).toEqual(["melody"]);
  });

  it("refuses to merge a node the runs already name", () => {
    expect(() =>
      run(RUNS, (d) => mergeSegments(d, { modules: { MIX: ["OUT"] } })),
    ).toThrow(/already in the graph/);
  });
});

describe("the canonical form", () => {
  it("emits what it parses", () => {
    const { value } = parseGraph(AUTHORED);
    if (!value) throw new Error("AUTHORED does not read");
    expect(formatChains(value, ["The signal graph, as segments."])).toBe(
      AUTHORED,
    );
  });
});
