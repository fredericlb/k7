import type { EnginePluginInfo } from "@studio/engine-browser";
import { describe, expect, it } from "vitest";
import { baseModuleRefs } from "./baseModules";

const plug = (name: string): EnginePluginInfo => ({
  name,
  format: "vst3",
  manufacturer: "x",
  id: name,
});

describe("baseModuleRefs", () => {
  it("names each plugin the way a module file does", () => {
    // The médiathèque's own files say `extends: "@engine/de-rez"`. Anything else here would
    // complete to a ref the loader cannot resolve, which is worse than completing to nothing.
    expect(
      baseModuleRefs([plug("Neural Amp Modeler"), plug("de-rez")]),
    ).toEqual(["@engine/de-rez", "@engine/neural-amp-modeler"]);
  });

  it("collapses two scans of one plugin, and drops what cannot be slugged", () => {
    expect(
      baseModuleRefs([plug("Chorus"), plug("chorus"), plug("- -"), plug("")]),
    ).toEqual(["@engine/chorus"]);
  });

  it("says nothing about a machine that has not answered", () => {
    // Empty means "we cannot say", not "this engine has no plugins" — the same reading
    // `scannedPlugins` puts on a missing cache.
    expect(baseModuleRefs([])).toEqual([]);
  });
});
