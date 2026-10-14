// A track's category, read off its prefix, its name, or its instrument — and the colours that say
// it: one hue per category, shades within one, so two guitars are both green and still two.

import { describe, expect, it } from "vitest";
import { arrangeByCategory, autoColors, categoryShade } from "./trackColor";
import { orderTracks, trackCategory } from "./trackKind";

describe("trackCategory", () => {
  it("reads a declared prefix first", () => {
    expect(trackCategory("vo.couz")).toBe("vox");
    expect(trackCategory("ch.back")).toBe("vox");
    expect(trackCategory("da.main")).toBe("drums");
    expect(trackCategory("bs.acid")).toBe("bass");
    expect(trackCategory("ge.lead")).toBe("guitar");
    expect(trackCategory("pi.wurli")).toBe("keys");
    expect(trackCategory("sy.jun")).toBe("synth");
    expect(trackCategory("sx.solo")).toBe("other");
  });
  // Names from real projects, none carrying a prefix.
  it("reads what an unprefixed name says", () => {
    expect(trackCategory("acoustic_drums_kit_ludwig_2_processed")).toBe(
      "drums",
    );
    expect(trackCategory("legend_505_kit")).toBe("drums");
    expect(trackCategory("basse")).toBe("bass");
    expect(trackCategory("vox")).toBe("vox");
    expect(trackCategory("folk")).toBe("guitar");
    expect(trackCategory("grand_piano_2")).toBe("keys");
    expect(trackCategory("polysynth-copy")).toBe("synth");
    expect(trackCategory("track-1")).toBe("other");
  });
  it("falls back on what the instrument says, and only then on other", () => {
    expect(trackCategory("audio_7", ["mu-tides"])).toBe("synth");
    expect(
      trackCategory("michel", ["@k7-core/instruments/keys/electric-keys"]),
    ).toBe("keys");
    expect(trackCategory("audio_7", ["mixer"])).toBe("other");
  });
});

describe("the colours", () => {
  it("gives one category one hue, and two of it two shades", () => {
    const c = autoColors([
      { id: "a", category: "guitar" },
      { id: "b", category: "vox" },
      { id: "c", category: "guitar" },
    ]);
    expect(c.get("a")).not.toBe(c.get("c"));
    expect(c.get("a")).toMatch(/^#[0-9a-f]{6}$/);
    // Green: the green channel leads.
    const g = c.get("a") ?? "";
    expect(Number.parseInt(g.slice(3, 5), 16)).toBeGreaterThan(
      Number.parseInt(g.slice(1, 3), 16),
    );
  });
  it("draws a single track of a category at its middle shade", () => {
    expect(categoryShade("drums", 0, 1)).toBe(categoryShade("drums", 0, 1));
    expect(categoryShade("drums", 0, 3)).not.toBe(categoryShade("drums", 2, 3));
  });
});

describe("the order", () => {
  it("arranges vox, drums, basses, guitars, keys, synths, then the rest — stable within one", () => {
    const names = [
      "sy.a",
      "track-1",
      "ge.b",
      "basse",
      "vo.c",
      "da.d",
      "pi.e",
      "ge.f",
    ];
    expect(arrangeByCategory(names, (n) => trackCategory(n))).toEqual([
      "vo.c",
      "da.d",
      "basse",
      "ge.b",
      "ge.f",
      "pi.e",
      "sy.a",
      "track-1",
    ]);
  });
  it("places an unprefixed name by what it says when no order is stated", () => {
    const sorted = orderTracks(["track-1", "basse", "vox"], (n) => n);
    expect(sorted).toEqual(["vox", "basse", "track-1"]);
  });
});
