// The base fingerprint a write sends: both sides must compute the same one, and a one-character
// edit must change it.

import { describe, expect, it } from "vitest";
import { textHash } from "./textHash";

describe("textHash", () => {
  it("is stable for one text", () => {
    expect(textHash("tempo(120)\n")).toBe(textHash("tempo(120)\n"));
    expect(textHash("")).toMatch(/^[0-9a-f]{14}$/);
  });

  it("moves for any edit, accents included", () => {
    const a = textHash('name("café")\n');
    expect(textHash('name("cafe")\n')).not.toBe(a);
    expect(textHash('name("café") \n')).not.toBe(a);
    expect(textHash('name("café")\r\n')).not.toBe(a);
  });
});
