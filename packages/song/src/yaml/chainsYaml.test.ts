import { describe, expect, it } from "vitest";
import {
  addNode,
  formatChains,
  insertBetween,
  nodeNames,
  parseChains,
  removeNode,
  renameNode,
  setModuleEnabled,
} from "./chainsFile";

// chains.yaml declares SEGMENTS: who feeds whom. Every edit here is an edge rewire, and
// the two properties that matter are the same as they were for the list format:
//
//   does the model survive       (nodes, destinations, bypass)
//   does an EDIT keep the file   (comments, layout, one-line diffs)
//
// …plus one the list format never had to answer: removing a module from the MIDDLE has to
// join what fed it to what it fed, or the signal is cut with nothing pointing at the cut.

// The canonical form: one node per line, destinations as a flow sequence. Written out
// here because it IS the contract — a file spaced any other way is re-spaced by the first
// edit, and then every node shows up in the diff.
const AUTHORED = `# The signal graph, as segments.
modules:
  vo.jo: [ eq_dj:vox ]
  da.main: [ drum_1 ]
  be.chorus: [ amp:bass ]
  eq_dj:vox: [ OUT ]
  drum_1: [ OUT ]
  amp:bass: [ cabinet ]
  cabinet: [ OUT ]
  reverb: [ OUT ]
bypassed: [ eq_dj:vox ]
`;

const diff = (a: string, b: string): string[] => {
  const before = a.split("\n");
  return b
    .split("\n")
    .map((l, i) => (l === before[i] ? null : `${i + 1}`))
    .filter((x): x is string => x !== null);
};

describe("the model survives the round trip", () => {
  it("reads nodes, destinations and bypass", () => {
    const { value, issues } = parseChains(AUTHORED);
    expect(issues).toEqual([]);
    // ONE map: the lanes and the modules are the same kind of node now.
    expect(value?.modules?.["vo.jo"]).toEqual(["eq_dj:vox"]);
    expect(value?.modules?.["da.main"]).toEqual(["drum_1"]);
    expect(value?.modules?.["amp:bass"]).toEqual(["cabinet"]);
    expect(value?.bypassed).toEqual(["eq_dj:vox"]);
  });

  it("keeps an instance ref whole, colon and all — as a KEY", () => {
    // `eq_dj:vox` was a value before and is a map key now, which is where `:` is most
    // dangerous: it is YAML's own key/value indicator. It survives (1.2 allows it inside
    // a plain scalar when no space follows), but nothing about that is obvious, and it is
    // the first thing that would break silently.
    const { value } = parseChains(AUTHORED);
    expect(Object.keys(value?.modules ?? {})).toContain("eq_dj:vox");
    expect(nodeNames(AUTHORED)).toContain("amp:bass");
  });

  it("names the old format rather than reporting an unknown key", () => {
    // Someone opening a project written before this change needs the migration, not
    // "unrecognized key: chains".
    const { value, issues } = parseChains(
      "chains:\n  - [ { track: a }, { module: OUT } ]\n",
    );
    expect(value).toBeNull();
    expect(issues[0].message).toMatch(/migrate chains/);
  });

  it("rejects an unknown section", () => {
    const { issues } = parseChains(
      "modules:\n  a: [ b ]\nbusses:\n  c: [ d ]\n",
    );
    expect(issues[0].message).toMatch(/busses/);
  });
});

describe("bypassing a module", () => {
  it("touches exactly one line", () => {
    const after = setModuleEnabled(AUTHORED, "drum_1", false);
    expect(diff(AUTHORED, after)).toEqual(["11"]);
    expect(after).toContain("bypassed: [ eq_dj:vox, drum_1 ]");
  });

  it("needs no chain to be named", () => {
    // The whole reason the list format asked for one: a module could sit in two chains,
    // and bypassing it in one had to leave the other running. A module is named ONCE
    // here, so there is only one thing to toggle.
    expect(setModuleEnabled(AUTHORED, "cabinet", false)).toContain(
      "bypassed: [ eq_dj:vox, cabinet ]",
    );
  });

  it("returns the file to what it was when toggled back", () => {
    const off = setModuleEnabled(AUTHORED, "drum_1", false);
    expect(setModuleEnabled(off, "drum_1", true)).toBe(AUTHORED);
  });

  it("drops the list entirely once it empties", () => {
    // Otherwise a project that has never bypassed anything carries `bypassed: []`, and
    // the empty list reads as a setting rather than as an absence.
    const on = setModuleEnabled(AUTHORED, "eq_dj:vox", true);
    expect(on).not.toContain("bypassed");
    expect(on).toContain("# The signal graph, as segments.");
  });

  it("says which name it couldn't find", () => {
    expect(() => setModuleEnabled(AUTHORED, "nope", false)).toThrow(
      /no module "nope"/,
    );
  });
});

describe("placing a module with no wiring", () => {
  it("adds it to `modules` with an empty destination list", () => {
    // The state the list format could not express: a module existed only as part of a
    // path, so it had to be wired the moment it was created.
    const after = addNode(AUTHORED, "wah");
    expect(after).toContain("wah: []");
    expect(parseChains(after).value?.modules?.wah).toEqual([]);
  });

  it("leaves a node it already knows alone", () => {
    // Re-adding must not be a way to silently unwire something.
    expect(addNode(AUTHORED, "cabinet")).toBe(AUTHORED);
    expect(addNode(AUTHORED, "da.main")).toBe(AUTHORED);
  });

  it("creates the section when the file has none", () => {
    const after = addNode("bypassed: [ x ]\n", "wah");
    expect(parseChains(after).value?.modules?.wah).toEqual([]);
  });
});

describe("inserting a module into an arrow", () => {
  it("rewires the two ends and nothing else", () => {
    const after = insertBetween(AUTHORED, "amp:bass", "cabinet", "filter");
    expect(after).toContain("amp:bass: [ filter ]");
    expect(after).toContain("filter: [ cabinet ]");
    expect(after).toContain("cabinet: [ OUT ]");
  });

  it("inserts on a TRACK's arrow, where the flow starts", () => {
    const after = insertBetween(AUTHORED, "da.main", "drum_1", "gate");
    expect(after).toContain("da.main: [ gate ]");
    expect(after).toContain("gate: [ drum_1 ]");
  });

  it("says so when the two ends aren't an arrow", () => {
    expect(() => insertBetween(AUTHORED, "da.main", "cabinet", "x")).toThrow(
      /does not feed 'cabinet'/,
    );
  });

  it("re-reads what it wrote", () => {
    const after = insertBetween(AUTHORED, "da.main", "drum_1", "verb");
    const { value, issues } = parseChains(after);
    expect(issues).toEqual([]);
    expect(value?.modules?.["da.main"]).toEqual(["verb"]);
    expect(value?.modules?.verb).toEqual(["drum_1"]);
  });
});

describe("removing a module", () => {
  it("joins what fed it to what it fed", () => {
    // The one thing the list format got for free: deleting a list item closed the gap.
    // Here the gap has to be closed on purpose, or `be.chorus` feeds a name that is gone.
    const { text, rewired } = removeNode(AUTHORED, "amp:bass");
    expect(text).toContain("be.chorus: [ cabinet ]");
    expect(text).not.toContain("amp:bass");
    expect(rewired).toEqual(["be.chorus"]);
  });

  it("takes its bypass with it", () => {
    // A name left in `bypassed` after its module is gone is a reference to nothing, and
    // the next module to be given that name would come up silently bypassed.
    const { text } = removeNode(AUTHORED, "eq_dj:vox");
    expect(text).not.toContain("bypassed");
    expect(text).toContain("vo.jo: [ OUT ]");
  });

  it("does not list a survivor twice when two branches rejoined through it", () => {
    const forked = `modules:\n  a: [ split ]\n  split: [ verb, OUT ]\n  verb: [ OUT ]\n`;
    const { text } = removeNode(forked, "verb");
    expect(text).toContain("split: [ OUT ]");
  });
});

describe("renaming a module", () => {
  it("moves the name, not the position", () => {
    const { text, rewired } = renameNode(AUTHORED, "cabinet", "cab:v2");
    expect(text).toContain("amp:bass: [ cab:v2 ]");
    expect(text).toContain("cab:v2: [ OUT ]");
    expect(rewired).toEqual(["amp:bass"]);
    // Still seventh in `modules`: a module has a place in the file, and rebuilding the map
    // key by key is what keeps a rename from shuffling it to the bottom.
    const keys = Object.keys(parseChains(text).value?.modules ?? {});
    expect(keys[6]).toBe("cab:v2");
  });

  it("carries a bypass across", () => {
    const { text } = renameNode(AUTHORED, "eq_dj:vox", "eq:v2");
    expect(text).toContain("bypassed: [ eq:v2 ]");
    expect(text).toContain("vo.jo: [ eq:v2 ]");
  });
});

describe("the canonical form", () => {
  it("emits what it parses", () => {
    const { value } = parseChains(AUTHORED);
    expect(formatChains(value!, "# The signal graph, as segments.")).toBe(
      AUTHORED,
    );
  });
});
