// The family guard and its refusal, which both HTTP shells now share rather than each spelling
// their own. The refusal is checked against FAMILIES so a fifth family cannot leave it behind.

import { describe, expect, it } from "vitest";
import { asFamily, FAMILIES, FAMILY_ERROR } from "./types.ts";

describe("asFamily", () => {
  it("accepts every family", () => {
    for (const f of FAMILIES) expect(asFamily(f)).toBe(f);
  });

  // Everything a query string can deliver: absent, empty, wrong case, an array, an object.
  it("rejects anything else", () => {
    for (const v of [undefined, null, "", "Songs", "song", ["songs"], {}, 0])
      expect(asFamily(v)).toBeUndefined();
  });
});

describe("FAMILY_ERROR", () => {
  it("names every family, so a new one cannot be left out of the message", () => {
    for (const f of FAMILIES) expect(FAMILY_ERROR).toContain(f);
  });
});
