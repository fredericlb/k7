// ast.test.ts — the tree helpers: a key's span, the walk, numeric path segments, and offsets as line and column.

import { describe, expect, it } from "vitest";
import { type K7Entry, type K7Path, nodeAt, walk } from "./ast.ts";
import { K7SyntaxError, lineCol, parseTree, parseValue } from "./parse.ts";

const TEXT = `a(1).b([10, 20, { c: 3 }])
"x y"({ 'z w': true })
`;

describe("an entry's key span", () => {
  it("covers the key as written, quotes included, in a chain and in an object", () => {
    const root = parseTree(TEXT);
    const keys = root.entries.map((e) => TEXT.slice(e.keyStart, e.keyEnd));
    expect(keys).toEqual(["a", "b", '"x y"']);
    const obj = nodeAt(root, ["x y"]);
    if (obj?.kind !== "map") throw new Error("not a map");
    const [e] = obj.entries;
    expect(TEXT.slice(e.keyStart, e.keyEnd)).toBe("'z w'");
  });
});

describe("walk", () => {
  it("visits every node depth-first with its path, and the entry of a map's value", () => {
    const seen: [K7Path, string | undefined][] = [];
    walk(parseTree(TEXT), (node, path, entry?: K7Entry) => {
      seen.push([path, entry?.key]);
      expect(nodeAt(parseTree(TEXT), path)).toEqual(node);
    });
    expect(seen).toEqual([
      [[], undefined],
      [["a"], "a"],
      [["b"], "b"],
      [["b", 0], undefined],
      [["b", 1], undefined],
      [["b", 2], undefined],
      [["b", 2, "c"], "c"],
      [["x y"], "x y"],
      [["x y", "z w"], "z w"],
    ]);
  });

  it("skips a subtree when the visitor returns false", () => {
    const seen: K7Path[] = [];
    walk(parseTree(TEXT), (node, path) => {
      seen.push(path);
      if (node.kind === "list") return false;
    });
    expect(seen).toContainEqual(["b"]);
    expect(seen).not.toContainEqual(["b", 0]);
  });
});

describe("nodeAt", () => {
  it("takes a string of digits as a list index, and nothing else", () => {
    const root = parseTree(TEXT);
    expect(nodeAt(root, ["b", "2", "c"])).toEqual(nodeAt(root, ["b", 2, "c"]));
    expect(nodeAt(root, ["b", "02"])).toBeUndefined();
    expect(nodeAt(root, ["b", "x"])).toBeUndefined();
  });
});

describe("lineCol", () => {
  it("counts lines and UTF-16 columns from 1, as a syntax error does", () => {
    const text = 'a("é")\nb(\n  bare)';
    expect(lineCol(text, 0)).toEqual({ line: 1, col: 1 });
    expect(lineCol(text, text.indexOf("b("))).toEqual({ line: 2, col: 1 });
    const at = text.indexOf("bare");
    expect(lineCol(text, at)).toEqual({ line: 3, col: 3 });
    try {
      parseTree(text);
      throw new Error("parsed");
    } catch (e) {
      const err = e as K7SyntaxError;
      expect({ line: err.line, col: err.column }).toEqual(lineCol(text, at));
    }
  });
});

describe("parseValue", () => {
  it("reads one value with trivia around it and refuses anything more", () => {
    expect(parseValue(" [1, 2] // two").kind).toBe("list");
    expect(parseValue("a(1).b(2)").kind).toBe("map");
    expect(() => parseValue("1, 2")).toThrow(K7SyntaxError);
    expect(() => parseValue("")).toThrow(K7SyntaxError);
  });
});
