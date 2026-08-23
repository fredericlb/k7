// What a module's alternatives ARE: the list it offers and which one a name selects. Pure
// struct work — APPLYING one is @studio/song's, and its own test lives beside it there.
// See packages/song/docs/alternatives.md.

import { describe, expect, it } from "vitest";
import { alternativesOf, pickAlternative } from "./alternatives";

describe("what a module's alternatives ARE", () => {
  it("counts the module's own fields as the first, unnamed", () => {
    // Not written down anywhere: the fields at the top of the file are the first set, which is
    // what keeps a module that never uses this byte-identical.
    // Typed as the open record a parsed module IS: the argument type has only optional keys,
    // so a bare literal sharing none of them is refused, and the point here is precisely a
    // module carrying ordinary fields and no `alternatives:`.
    const m: Record<string, unknown> = { params: { Gain: 3 } };
    expect(alternativesOf(m)).toEqual([{ name: "1", at: 1 }]);
  });

  it("numbers an unnamed one by its position, counting the first", () => {
    const m = { alternatives: [{ params: {} }, { name: "crunch" }] };
    expect(alternativesOf(m).map((a) => a.name)).toEqual(["1", "2", "crunch"]);
  });

  it("takes a NAME over a number, so a set called `2` is what `2` selects", () => {
    const names = ["1", "2", "3"];
    expect(pickAlternative(names, "2")).toBe(1);
    // …and a name that matches nothing falls back to the first rather than silencing it.
    expect(pickAlternative(names, "nope")).toBe(0);
    expect(pickAlternative(names, undefined)).toBe(0);
    expect(pickAlternative(names, 3)).toBe(2);
  });
});
