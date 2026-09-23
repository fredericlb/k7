// The stored list of notices already shown: whatever the browser kept, it reads as a set of ids.

import { describe, expect, it } from "vitest";
import { readShown } from "./useShownOnce";

describe("readShown", () => {
  it("reads the ids a browser kept", () => {
    expect([...readShown('["s1","s2"]')]).toEqual(["s1", "s2"]);
  });

  it("counts nothing kept, or something unreadable, as none shown", () => {
    for (const raw of [null, "", "{", '{"s1":true}', "42"])
      expect(readShown(raw).size).toBe(0);
  });
});
