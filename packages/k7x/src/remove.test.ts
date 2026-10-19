// remove.test.ts — deleteIn: what prune takes with a deletion, and the separators and comments around what it removes.

import { describe, expect, it } from "vitest";
import { type K7Document, parseDocument } from "./edit.ts";

const edit = (text: string, f: (d: K7Document) => void): string => {
  const d = parseDocument(text);
  f(d);
  return d.toString();
};

const TEXT = `a(1)
engines({
  tracktion: {
    params: { Ratio: 0.5 }, // the only one
  },
})
`;

describe("deleteIn with prune", () => {
  it("removes every ancestor map the deletion emptied", () => {
    expect(
      edit(TEXT, (d) =>
        d.deleteIn(["engines", "tracktion", "params", "Ratio"], {
          prune: true,
        }),
      ),
    ).toBe("a(1)\n");
  });

  it("leaves the empty maps without it", () => {
    const out = edit(TEXT, (d) =>
      d.deleteIn(["engines", "tracktion", "params", "Ratio"]),
    );
    expect(parseDocument(out).getIn(["engines"])).toEqual({
      tracktion: { params: {} },
    });
  });

  it("stops at a map that still holds something", () => {
    const text = "e({ x: { y: 1 }, z: 2 })";
    expect(
      edit(text, (d) => d.deleteIn(["e", "x", "y"], { prune: true })),
    ).toBe("e({ z: 2 })");
  });

  it("never removes the root, nor a list item", () => {
    expect(
      edit("a({ b: 1 })", (d) => d.deleteIn(["a", "b"], { prune: true })),
    ).toBe("");
    expect(
      edit("l([{ b: 1 }, 2])", (d) =>
        d.deleteIn(["l", 0, "b"], { prune: true }),
      ),
    ).toBe("l([{}, 2])");
  });

  it("deletes nothing at the root path", () => {
    expect(parseDocument("a(1)").deleteIn([])).toBe(false);
  });
});

describe("deleteIn and the comments around what it removes", () => {
  it("keeps a neighbour's line comment when the removed entry shares its line", () => {
    const text = "o({\n  a: 1,\n  b: 2, // tail\n  /* c */ c: 3,\n})\n";
    const out = edit(text, (d) => d.deleteIn(["o", "c"]));
    expect(out).toContain("b: 2, // tail\n");
    expect(parseDocument(out).getIn(["o"])).toEqual({ a: 1, b: 2 });
    const mid = edit("o({ x: 0, a: 1, // c\n  b: 2 })", (d) =>
      d.deleteIn(["o", "a"]),
    );
    expect(mid).toBe("o({ x: 0, // c\n  b: 2 })");
  });

  it("takes a comma written first on the next line along with the item", () => {
    expect(
      edit("l([t(0).d(1) // one\n  , t(2)])\n", (d) => d.deleteIn(["l", 0])),
    ).toBe("l([ // one\n  t(2)])\n");
    expect(edit("l([\n  1\n  , 2\n])\n", (d) => d.deleteIn(["l", 0]))).toBe(
      "l([\n  2\n])\n",
    );
  });

  it("writes a list emptied of its last line as [], and keeps one holding a comment", () => {
    const text = "l([\n  1, // one\n])\n";
    expect(edit(text, (d) => d.deleteIn(["l", 0]))).toBe("l([])\n");
    const kept = "l([\n  // keep\n  1,\n])\n";
    expect(edit(kept, (d) => d.deleteIn(["l", 0]))).toBe(
      "l([\n  // keep\n])\n",
    );
    expect(edit(kept, (d) => d.applyIn(["l"], []))).toBe(
      "l([\n  // keep\n])\n",
    );
    expect(edit("l([1, 2])\n", (d) => d.applyIn(["l"], []))).toBe("l([])\n");
  });
});
