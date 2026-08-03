// What the module builder can bind on a mixer strip.
//
// The bind list is the only place a widget can pick a name up from, so a module whose params are invisible here
// cannot be given a panel at all. Three sources feed it and two of them are LEARNED — the base's own `params:`
// and whatever extends it — which is why the mixer had an empty list the day it shipped: pistes defines the
// plugin, and nothing in any project had authored a param on it yet.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_PLUGIN_PARAMS } from "./builtinParams";
import { projectHints } from "./hints";
import { MIXER_PARAMS, MIXER_PLUGIN } from "./project";
import { writeModule, writeYaml } from "./testSupport";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-mixer-hints-"));
  writeYaml(join(dir, "project.yaml"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeFileSync(
    join(dir, "chains.yaml"),
    "tracks:\n  vox: [ mixer:vox ]\nmodules:\n  mixer:vox: [ OUT ]\n",
    "utf8",
  );
  writeModule(dir, "io", "OUT", { io: "out" });
  writeModule(dir, "audio", "mixer", {
    plugin: { type: "internal", name: MIXER_PLUGIN },
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a built-in's params are known without a project having authored one", () => {
  it("lists every mixer param on a strip nobody has touched", () => {
    // No instance file at all: the plugin is the only thing that can say what it has.
    const h = projectHints(dir);
    expect(h.paramsByBase["audio/mixer"]).toEqual([...MIXER_PARAMS].sort());
  });

  it("carries the RANGES, which no learned name ever has", () => {
    // A widget bound without a range is drawn 0..1. On a -60..+6 dB fader that is not a cosmetic problem: the
    // knob writes the wrong number into the file.
    const meta = projectHints(dir).paramMetaByBase["audio/mixer"];
    expect(meta.Volume).toEqual({ min: -60, max: 6, def: 0 });
    expect(meta.Pan).toEqual({ min: -1, max: 1, def: 0 });
    for (const band of ["Low", "Mid", "High"])
      expect(meta[band]).toEqual({ min: -18, max: 18, def: 0 });
  });

  it("keeps the C++ plugin and this table naming the same five params", () => {
    // The half that breaks silently: a rename in MixerPlugin.cpp leaves every existing binding pointing at a
    // name the plugin no longer answers to, and nothing else in the build would notice.
    expect(BUILTIN_PLUGIN_PARAMS[MIXER_PLUGIN].map((p) => p.name)).toEqual([
      ...MIXER_PARAMS,
    ]);
  });
});

describe("an instance counts as much as an extender", () => {
  it("picks up a param authored only on one strip", () => {
    // `mixer:vox` is `mixer` with its own values, exactly as an `extends:` module is. Leaving instances out made
    // every param on every strip of a real song invisible to the builder.
    writeModule(dir, "audio", "mixer", { params: { Drive: 3 } }, "vox");
    expect(projectHints(dir).paramsByBase["audio/mixer"]).toContain("Drive");
  });
});
