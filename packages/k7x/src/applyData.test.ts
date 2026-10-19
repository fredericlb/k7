// applyData.test.ts — applyIn makes the data at a path equal a value with the fewest edits, every untouched byte kept.

import { describe, expect, it } from "vitest";
import { parseDocument } from "./edit.ts";

const NOTES = `// the melody
notes([
  t(0).d(1).k(60),
  t(1).d(1).k(62), // the second
  t(2).d(1).k(64),
])
params({ gain: 1, pan: 0 }) // mix
`;

const applied = (path: (string | number)[], value: unknown): string => {
  const d = parseDocument(NOTES);
  d.applyIn(path, value);
  expect(d.getIn(path)).toEqual(value);
  return d.toString();
};

describe("applyIn", () => {
  it("changes nothing when the data is already equal", () => {
    const d = parseDocument(NOTES);
    d.applyIn([], d.toJS());
    expect(d.toString()).toBe(NOTES);
    expect(d.changes).toEqual([]);
  });

  it("rewrites a changed leaf only, comments kept", () => {
    const value = parseDocument(NOTES).toJS();
    (value.notes as { k: number }[])[1].k = 63;
    expect(applied([], value)).toBe(NOTES.replace("k(62)", "k(63)"));
  });

  it("adds and removes keys under a path", () => {
    expect(applied(["params"], { gain: 1, width: 2 })).toBe(
      NOTES.replace("{ gain: 1, pan: 0 }", "{ gain: 1, width: 2 }"),
    );
  });

  it("splices a list's middle, its head and tail kept as written", () => {
    const notes = [
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 1, k: 62 },
      { t: 1.5, d: 1, k: 63 },
      { t: 2, d: 1, k: 64 },
    ];
    expect(applied(["notes"], notes)).toBe(
      NOTES.replace(
        "  t(2).d(1).k(64),",
        "  t(1.5).d(1).k(63),\n  t(2).d(1).k(64),",
      ),
    );
    expect(applied(["notes"], [notes[0], notes[3]])).toBe(
      NOTES.replace("  t(1).d(1).k(62), // the second\n", ""),
    );
    expect(applied(["notes"], [])).toBe(
      NOTES.replace(/notes\(\[[\s\S]*?\n\]\)/, "notes([])"),
    );
  });

  it("creates a missing path and replaces a value of another shape", () => {
    expect(applied(["extra", "x"], [1])).toBe(`${NOTES}extra({ x: [1] })\n`);
    expect(applied(["params"], 3)).toBe(
      NOTES.replace("{ gain: 1, pan: 0 }", "3"),
    );
  });
});

describe("applyIn and the keys it compares", () => {
  it("deletes a key set to undefined, and one named like an Object member", () => {
    const d = parseDocument("a(1).b(2)\ntoString(3)\nconstructor(4)\n");
    d.applyIn([], { a: undefined, b: 2, valueOf: 5 });
    expect(d.toJS()).toEqual({ b: 2, valueOf: 5 });
  });
});
