// document.test.ts — the document's header, where a path is written, and the change log an editor replays.

import { describe, expect, it } from "vitest";
import { type K7Change, parseDocument } from "./edit.ts";

const NODE = `// synth-pad
//
// a pad
extends("@workspace/instruments/synth")
params({
  "Filter Freq": 40, // darker than the lead
  Level: -12,
})
`;

const replay = (text: string, changes: readonly K7Change[]): string =>
  changes.reduce(
    (t, c) => t.slice(0, c.start) + c.insert + t.slice(c.end),
    text,
  );

describe("the header", () => {
  it("reads the // lines the file starts with", () => {
    expect(parseDocument(NODE).header).toEqual(["synth-pad", "", "a pad"]);
    expect(parseDocument("a(1) // x\n").header).toEqual([]);
    expect(parseDocument("\n// late\na(1)").header).toEqual([]);
  });

  it("replaces, adds and removes it, the rest of the file kept", () => {
    const d = parseDocument(NODE);
    d.setHeader(["synth pad", "v2"]);
    expect(d.toString()).toBe(
      NODE.replace("// synth-pad\n//\n// a pad\n", "// synth pad\n// v2\n"),
    );
    expect(d.header).toEqual(["synth pad", "v2"]);
    d.setHeader([]);
    expect(d.toString()).toBe(NODE.replace("// synth-pad\n//\n// a pad\n", ""));
    d.setHeader(["", "back"]);
    expect(d.toString()).toBe(
      NODE.replace("// synth-pad\n//\n// a pad\n", "//\n// back\n"),
    );
  });

  it("round-trips: what setHeader writes, header reads back", () => {
    for (const lines of [["a"], ["", "b", ""], ["x  y", "// nested"]]) {
      const d = parseDocument("a(1)\n");
      d.setHeader(lines);
      expect(d.header).toEqual(lines);
      expect(d.toJS()).toEqual({ a: 1 });
    }
  });

  it("works on an empty file and on a file that is only a header", () => {
    const d = parseDocument("");
    d.setHeader(["new"]);
    expect(d.toString()).toBe("// new\n");
    const only = parseDocument("// old");
    only.setHeader(["new"]);
    expect(only.toString()).toBe("// new");
  });
});

describe("positionOf", () => {
  it("gives an entry's key and an item's first character, 1-based", () => {
    const d = parseDocument(NODE);
    expect(d.positionOf(["extends"])).toEqual({ line: 4, col: 1 });
    expect(d.positionOf(["params", "Level"])).toEqual({ line: 7, col: 3 });
    expect(d.positionOf(["params", "Filter Freq"])).toEqual({
      line: 6,
      col: 3,
    });
    expect(d.positionOf([])).toEqual({ line: 1, col: 1 });
    expect(d.positionOf(["nope"])).toBeUndefined();
    const list = parseDocument("l([\n  1,\n  2,\n])");
    expect(list.positionOf(["l", 1])).toEqual({ line: 3, col: 3 });
  });
});

describe("changes", () => {
  it("replays every edit in order onto the original text", () => {
    const d = parseDocument(NODE);
    d.setIn(["params", "Level"], -6);
    d.setIn(["params", "Detune"], 3);
    d.deleteIn(["params", "Filter Freq"]);
    d.setIn(["bypass"], true);
    d.renameKey(["extends"], "base");
    d.setHeader(["renamed"]);
    d.applyIn(["tags"], ["a", "b"]);
    d.moveIn(["tags"], 1, 0);
    d.setSourceIn(["params", "Level"], "-3");
    expect(d.changes.length).toBeGreaterThanOrEqual(9);
    expect(replay(NODE, d.changes)).toBe(d.toString());
  });

  it("records nothing for an edit that changes nothing, nor for one refused", () => {
    const d = parseDocument(NODE);
    d.setIn(["params", "Level"], -12);
    expect(() => d.setSourceIn(["params", "Level"], "(")).toThrow();
    expect(d.changes).toEqual([]);
  });

  it("records a whole-file write as one splice", () => {
    const d = parseDocument(NODE);
    d.setIn([], { a: 1 });
    expect(d.changes).toEqual([
      { start: 0, end: NODE.length, insert: "a(1)\n" },
    ]);
  });
});

describe("the header's edge cases", () => {
  it("writes a line holding a newline as several comment lines, never as data", () => {
    const d = parseDocument("a(1)\n");
    d.setHeader(["x\nb(2)"]);
    expect(d.toJS()).toEqual({ a: 1 });
    expect(d.header).toEqual(["x", "b(2)"]);
  });

  it("goes after a byte-order mark, and keeps an author's spacing when the lines read the same", () => {
    const d = parseDocument("﻿//a\r\n// b\r\na(1)\r\n");
    expect(d.header).toEqual(["a", "b"]);
    d.setHeader(["a", "b"]);
    expect(d.changes).toEqual([]);
    d.setHeader(["c"]);
    expect(d.toString()).toBe("﻿// c\na(1)\r\n");
  });
});
