// write.test.ts — source as written, moved items, renamed keys, inline layout, empty containers: the exact text after each edit.

import { describe, expect, it } from "vitest";
import { type K7Document, parseDocument } from "./edit.ts";

const edit = (text: string, f: (d: K7Document) => void): string => {
  const d = parseDocument(text);
  f(d);
  return d.toString();
};

const NODE = `// synth-pad
extends("@workspace/instruments/synth")
params({
  "Filter Freq": 40, // darker than the lead
  Level: -12,
})
notes([
  t(0).k(60), // first
  t(1).k(62),
  t(2).k(64),
])
`;

describe("getSource and setSourceIn", () => {
  it("reads a node's exact source, comments inside it included", () => {
    const d = parseDocument(NODE);
    expect(d.getSource(["notes", 1])).toBe("t(1).k(62)");
    expect(d.getSource(["params"])).toContain("// darker than the lead");
    expect(d.getSource(["nope"])).toBeUndefined();
    expect(parseDocument("a() b(1, 2)").getSource(["b"])).toBe("1, 2");
  });

  it("replaces a value with source as written, and creates a missing key", () => {
    expect(
      edit(NODE, (d) => d.setSourceIn(["params", "Level"], "-6 /* dB */")),
    ).toBe(NODE.replace("Level: -12,", "Level: -6 /* dB */,"));
    expect(edit("a(1)\n", (d) => d.setSourceIn(["b", "c"], "x(1).y(2)"))).toBe(
      "a(1)\nb({ c: x(1).y(2) })\n",
    );
    expect(edit("flag()", (d) => d.setSourceIn(["flag"], "false"))).toBe(
      "flag(false)",
    );
  });

  it("refuses source that is not one value", () => {
    const d = parseDocument(NODE);
    expect(() => d.setSourceIn(["params", "Level"], "1, 2")).toThrow();
    expect(() => d.setSourceIn(["params", "Level"], "bare")).toThrow();
    expect(d.toString()).toBe(NODE);
  });

  it("inserts list items from source, on a line of their own where items have one", () => {
    expect(
      edit(NODE, (d) => d.insertSourceIn(["notes"], 1, "t(0.5).k(61)")),
    ).toBe(NODE.replace("  t(1).k(62),", "  t(0.5).k(61),\n  t(1).k(62),"));
    expect(edit("l([1, 3])", (d) => d.insertSourceIn(["l"], 1, "2"))).toBe(
      "l([1, 2, 3])",
    );
    expect(edit("l([1])", (d) => d.insertSourceIn(["l"], 5, "{ a: 1 }"))).toBe(
      "l([1, { a: 1 }])",
    );
  });
});

describe("moveIn", () => {
  it("moves an item of a multi-line list, its source kept", () => {
    const out = edit(NODE, (d) => d.moveIn(["notes"], 2, 0));
    expect(parseDocument(out).getIn(["notes"])).toEqual([
      { t: 2, k: 64 },
      { t: 0, k: 60 },
      { t: 1, k: 62 },
    ]);
    expect(out).toContain("  t(2).k(64),\n  t(0).k(60), // first\n");
  });

  it("moves within one line, to the end, and in a call's argument list", () => {
    expect(edit("l([1, 2, 3])", (d) => d.moveIn(["l"], 0, 2))).toBe(
      "l([2, 3, 1])",
    );
    expect(edit("l(1, 2, 3)", (d) => d.moveIn(["l"], 2, 0))).toBe("l(3, 1, 2)");
    expect(() => edit("l([1])", (d) => d.moveIn(["l"], 0, 1))).toThrow();
  });
});

describe("renameKey", () => {
  it("renames an object entry, its value and comment kept", () => {
    expect(
      edit(NODE, (d) => d.renameKey(["params", "Filter Freq"], "Cutoff")),
    ).toBe(NODE.replace('"Filter Freq": 40', "Cutoff: 40"));
  });

  it("renames a root call and a chained call, quoting a key that is not a word", () => {
    expect(edit(NODE, (d) => d.renameKey(["extends"], "base"))).toBe(
      NODE.replace("extends(", "base("),
    );
    expect(edit(NODE, (d) => d.renameKey(["notes", 1, "k"], "key note"))).toBe(
      NODE.replace("t(1).k(62)", 't(1)."key note"(62)'),
    );
  });

  it("refuses a key the map already has, and a missing entry", () => {
    const d = parseDocument(NODE);
    expect(() => d.renameKey(["params", "Level"], "Filter Freq")).toThrow();
    expect(() => d.renameKey(["params", "Nope"], "x")).toThrow();
    d.renameKey(["params", "Level"], "Level");
    expect(d.toString()).toBe(NODE);
  });
});

describe("inline layout", () => {
  const WIDE = Array.from({ length: 12 }, (_, i) => ({ t: i, d: 1, k: 60 }));

  it("breaks a wide value by default and keeps it on one line when asked", () => {
    expect(edit("a(1)\n", (d) => d.setIn(["s"], WIDE)).split("\n").length).toBe(
      16,
    );
    const one = edit("a(1)\n", (d) => d.setIn(["s"], WIDE, { inline: true }));
    expect(one.split("\n")).toHaveLength(3);
    expect(parseDocument(one).getIn(["s"])).toEqual(WIDE);
  });

  it("applies to addIn and insertIn", () => {
    const big = { a: "x".repeat(60), b: "y".repeat(60) };
    const added = edit("l([\n  1,\n])", (d) =>
      d.addIn(["l"], big, { inline: true }),
    );
    expect(added).toBe(
      `l([\n  1,\n  a(${JSON.stringify(big.a)}).b(${JSON.stringify(big.b)}),\n])`,
    );
    const inserted = edit("l([\n  1,\n])", (d) =>
      d.insertIn(["l"], 0, big, { inline: true }),
    );
    expect(inserted.split("\n")).toHaveLength(4);
  });
});

describe("numeric path segments", () => {
  it("reads a string of digits as an index in setIn and deleteIn", () => {
    expect(edit("l([1, 2, 3])", (d) => d.setIn(["l", "1"], 5))).toBe(
      "l([1, 5, 3])",
    );
    expect(edit("l([1, 2, 3])", (d) => d.deleteIn(["l", "1"]))).toBe(
      "l([1, 3])",
    );
  });
});

describe("what a write refuses or keeps", () => {
  it("refuses source whose last line ends in a // comment, which would swallow the rest of its line", () => {
    const d = parseDocument("a([\n  0, 5,\n])\n");
    expect(() => d.setSourceIn(["a", 0], "1 // one")).toThrow(/comment/);
    expect(() => d.insertSourceIn(["a"], 1, "1 // one")).toThrow(/comment/);
    d.setSourceIn(["a", 0], "{\n  b: 1, // kept\n}");
    expect(d.getIn(["a"])).toEqual([{ b: 1 }, 5]);
  });

  it("refuses an index that is not a list position", () => {
    const d = parseDocument("l([1, 2])");
    expect(() => d.insertIn(["l"], -1, 0)).toThrow(/k7x/);
    expect(() => d.moveIn(["l"], 0.5, 1)).toThrow(/k7x/);
  });

  it("carries a moved item's line comment with it", () => {
    expect(
      edit("l([\n  1, // one\n  2,\n  3\n])\n", (d) => d.moveIn(["l"], 0, 2)),
    ).toBe("l([\n  2,\n  3,\n  1, // one\n])\n");
    expect(
      edit("l([\n  1,\n  2,\n  3, // three\n])\n", (d) =>
        d.moveIn(["l"], 2, 0),
      ),
    ).toBe("l([\n  3, // three\n  1,\n  2,\n])\n");
  });
});

describe("writing into an empty container that holds a comment", () => {
  it("keeps the comment, the new child after it", () => {
    expect(
      edit("x({\n  // params here\n})\n", (d) => d.setIn(["x", "a"], 1)),
    ).toBe("x({\n  // params here\n  a: 1,\n})\n");
    expect(edit("x([\n  // items here\n])\n", (d) => d.addIn(["x"], 1))).toBe(
      "x([\n  // items here\n  1,\n])\n",
    );
    expect(edit("x([ /* none */ ])\n", (d) => d.insertIn(["x"], 0, 1))).toBe(
      "x([ /* none */ 1 ])\n",
    );
  });
});
