// The compatibility score. A wrong one is silent twice over: auto-choice picks an engine that
// plays the song without its synth, and the header draws no warning to say so.

import { describe, expect, it } from "vitest";
import { compatibility } from "./compat.ts";

const catalogue = [
  { format: "internal", name: "4OSC", id: "4osc" },
  { format: "internal", name: "Volume & Pan", id: "volume" },
  { format: "VST3", name: "Serum", id: "/Library/Audio/Serum.vst3" },
];

describe("compatibility", () => {
  it("is 100 when the engine has every plugin the project needs", () => {
    expect(
      compatibility(
        [
          { format: "internal", name: "4osc" },
          { format: "vst3", name: "Serum" },
        ],
        catalogue,
      ),
    ).toEqual({ score: 100, missing: [] });
  });

  // A module authors a built-in by its type name, the catalogue by its display name.
  it("matches a built-in by its type name as well as its display name", () => {
    expect(
      compatibility([{ format: "internal", name: "volume" }], catalogue).score,
    ).toBe(100);
    expect(
      compatibility([{ format: "internal", name: "Volume & Pan" }], catalogue)
        .score,
    ).toBe(100);
  });

  it("is available over required, and names what is missing", () => {
    const c = compatibility(
      [
        { format: "vst3", name: "Serum" },
        { format: "vst3", name: "Diva" },
        { format: "internal", name: "4osc" },
      ],
      catalogue,
    );
    // 2 of 3, floored: only a full house may read 100.
    expect(c.score).toBe(66);
    expect(c.missing).toEqual([{ format: "vst3", name: "Diva" }]);
  });

  it("counts a plugin used twice once", () => {
    expect(
      compatibility(
        [
          { format: "vst3", name: "Diva" },
          { format: "vst3", name: "diva" },
          { format: "vst3", name: "Serum" },
        ],
        catalogue,
      ).score,
    ).toBe(50);
  });

  // The format is part of the identity: a VST2 build is not the VST3 the project names.
  it("does not match a plugin across formats", () => {
    expect(
      compatibility([{ format: "vst", name: "Serum" }], catalogue).score,
    ).toBe(0);
  });

  it("is 100 for a project that needs nothing, even on an empty engine", () => {
    expect(compatibility([], [])).toEqual({ score: 100, missing: [] });
  });
});
