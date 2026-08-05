// treeOrder.test.ts — what the one order promises: it reaches every level, it reads names the
// way a person does, and it leaves the listing it was handed alone.

import { describe, expect, it } from "vitest";
import { sortNodes } from "./treeOrder";

// The minimum the comparator reads — a folder row and a file row differ only by `children`,
// which is what both trees hand it.
interface Node {
  name: string;
  children?: Node[];
}

const names = (nodes: { name: string }[]) => nodes.map((n) => n.name);

describe("sortNodes", () => {
  it("sorts a level and everything under it", () => {
    const sorted = sortNodes<Node>([
      { name: "wah", children: [{ name: "b" }, { name: "a" }] },
      { name: "amp", children: [] },
    ]);
    expect(names(sorted)).toEqual(["amp", "wah"]);
    expect(names(sorted[1].children ?? [])).toEqual(["a", "b"]);
  });

  // Folders and files mixed: a tree that grouped them would order by a thing you cannot see
  // from the name you are looking for.
  it("mixes folders and files", () => {
    const sorted = sortNodes<Node>([
      { name: "solo.wav" },
      { name: "riffs", children: [] },
      { name: "amp.wav" },
    ]);
    expect(names(sorted)).toEqual(["amp.wav", "riffs", "solo.wav"]);
  });

  it("ignores case and accents, and counts numbers", () => {
    expect(names(sortNodes([{ name: "Ébène" }, { name: "eau" }]))).toEqual([
      "eau",
      "Ébène",
    ]);
    expect(
      names(sortNodes([{ name: "prise 10" }, { name: "prise 2" }])),
    ).toEqual(["prise 2", "prise 10"]);
  });

  // The nodes come from React state, so a sort in place would be a mutation nothing asked for.
  it("leaves what it was given untouched", () => {
    const nodes: Node[] = [
      { name: "b", children: [{ name: "z" }, { name: "y" }] },
      { name: "a" },
    ];
    sortNodes(nodes);
    expect(names(nodes)).toEqual(["b", "a"]);
    expect(names(nodes[0].children ?? [])).toEqual(["z", "y"]);
  });
});
