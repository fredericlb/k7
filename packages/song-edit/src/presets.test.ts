// The preset tree's vocabulary: which folder a module's presets sit in, the file a name is, and the
// text a preset is written as. The verbs over them are tested in @studio/commands' nodePreset.test.ts.

import { join, resolve } from "node:path";
import { parse } from "@studio/k7x/document";
import { presetFileText, presetModulePath } from "@studio/song-schema/presets";
import { describe, expect, it } from "vitest";
import { presetFile } from "./presets";

describe("presetModulePath", () => {
  it("is the ref without its @, one folder per segment", () => {
    expect(presetModulePath("@k7-core/audio/reverb")).toBe(
      "k7-core/audio/reverb",
    );
    expect(presetModulePath("@workspace/audio/amps/nam")).toBe(
      "workspace/audio/amps/nam",
    );
  });

  it("refuses a bare ref, a lone namespace and a segment that climbs", () => {
    expect(presetModulePath("audio/reverb")).toBeNull();
    expect(presetModulePath("@k7-core")).toBeNull();
    expect(presetModulePath("@k7-core/../etc")).toBeNull();
    expect(presetModulePath("@k7-core//x")).toBeNull();
  });
});

describe("presetFile", () => {
  const song = resolve("/ws/song.k7");

  it("lands in the workspace's _presets, under the module's path", () => {
    expect(
      presetFile(song, "workspace", "@k7-core/audio/reverb", "big hall"),
    ).toBe(
      join(
        resolve("/ws"),
        "_presets",
        "k7-core",
        "audio",
        "reverb",
        "big hall.k7x",
      ),
    );
  });

  it("refuses a name that is not a plain file name", () => {
    for (const bad of ["../x", "a/b", "", " lead", "x.k7x"])
      expect(() =>
        presetFile(song, "workspace", "@k7-core/audio/reverb", bad),
      ).toThrow(/invalid preset name/);
  });

  it("refuses a scope that is no library of this machine", () => {
    expect(() =>
      presetFile(song, "nope-lib", "@k7-core/audio/reverb", "x"),
    ).toThrow(/no library/);
  });
});

describe("presetFileText", () => {
  it("reads back as what it was given", () => {
    const preset = {
      engine: "vari-mu",
      params: { "Output Level": 0.8, on: 1, Mix: 0.25 },
    };
    const text = presetFileText("@k7-core/audio/comp", preset);
    expect(parse(text)).toEqual(preset);
  });

  it("keeps the base the values were taken over", () => {
    const preset = {
      base: "Pads/Bell Pad",
      params: { "A Filter 1 Cutoff": 0.3 },
    };
    const text = presetFileText("@k7-core/instruments/synth/surge-xt", preset);
    expect(parse(text)).toEqual(preset);
  });
});
