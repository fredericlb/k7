import { describe, expect, it } from "vitest";
import { rackKeyNames } from "./rackFor";

describe("rackKeyNames — what the roll's key column calls a rack key", () => {
  it("names a key after its sample's file, without folder or extension", () => {
    const names = rackKeyNames([
      { symbol: "BD", note: 36, sample: "@st0/samples/kits/909/Kick Hard.wav" },
    ]);
    expect(names.get(36)).toBe("Kick Hard");
  });

  it("falls back to the clip, then to the symbol", () => {
    const names = rackKeyNames([
      { symbol: "SN", note: 38, clip: "snare-take-3" },
      { symbol: "HH", note: 42 },
    ]);
    expect(names.get(38)).toBe("snare-take-3");
    expect(names.get(42)).toBe("HH");
  });

  it("joins two sounds on one key and leaves other keys out", () => {
    const names = rackKeyNames([
      { symbol: "A", note: 40, sample: "a.wav" },
      { symbol: "B", note: 40, sample: "b.wav" },
    ]);
    expect(names.get(40)).toBe("a / b");
    expect(names.has(41)).toBe(false);
  });
});
