// A project's own `modules/` may FILE its modules one level deep — `audio/amps/neural-amp-modeler`
// — exactly as a shared library may. Two walkers read one vocabulary and both have to recurse:
// `readModuleTree` (the médiathèque, `_modules`) and `loadModules` (the project's own). A folder
// with no `module.yaml` is skipped in SILENCE, so a filed module one walker misses is not an
// error, it is simply not there — and every symptom then describes something else.
//
// Only a project whose `modules/` is not flat shows it: the module bench, whose `modules/`
// mirrors the médiathèque's catalogue.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleKeyFromPath } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules } from "./loader";
import { writeModule } from "./testSupport";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-filed-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a module filed under a category folder", () => {
  it("is loaded, and keyed by the path below its type", () => {
    writeModule(dir, "audio", "reverb", {
      plugin: { type: "vst3", name: "R" },
    });
    writeModule(dir, "audio", "amps/neural-amp-modeler", {
      plugin: { type: "vst3", name: "NAM" },
    });

    const mods = loadModules(dir);
    expect(Object.keys(mods).sort()).toEqual([
      "amps/neural-amp-modeler",
      "reverb",
    ]);
    // `file` is what `moduleRefOf` turns into a ref, so it carries the filing too.
    expect(mods["amps/neural-amp-modeler"].file).toBe(
      "amps/neural-amp-modeler",
    );
    expect(mods["amps/neural-amp-modeler"].category).toBe("audio");
  });

  it("finds its .vstpreset beside its own module.yaml, not under the category", () => {
    writeModule(dir, "audio", "amps/neural-amp-modeler", {
      plugin: { type: "vst3", name: "NAM" },
    });
    // The module's OWN folder: joining the whole key names a directory that does not exist.
    const preset = join(
      dir,
      "modules/audio/amps/neural-amp-modeler/neural-amp-modeler.vstpreset",
    );
    writeFileSync(preset, "x");

    expect(loadModules(dir)["amps/neural-amp-modeler"].preset).toBe(preset);
  });

  it("is named the same way by a browser reading only the path", () => {
    // The builder maps the open FILE to a chain key, and a different spelling finds no plugin.
    writeModule(dir, "audio", "amps/neural-amp-modeler", {
      plugin: { type: "vst3", name: "NAM" },
    });
    const key = Object.keys(loadModules(dir))[0];
    expect(
      moduleKeyFromPath(
        "banc.st0/modules/audio/amps/neural-amp-modeler/module.yaml",
      ),
    ).toBe(key);
    // Any of the module's three files answers the same, and a flat one still works.
    expect(
      moduleKeyFromPath("modules/audio/amps/neural-amp-modeler/ui.yaml"),
    ).toBe("amps/neural-amp-modeler");
    expect(moduleKeyFromPath("modules/audio/reverb/module.yaml")).toBe(
      "reverb",
    );
    // Not a module path at all.
    expect(moduleKeyFromPath("banc.st0/graph.yaml")).toBeNull();
    expect(moduleKeyFromPath("modules/nonsense/x/module.yaml")).toBeNull();
  });

  it("still ignores a folder that is neither a module nor a filing of one", () => {
    // ONE level of filing, as in a shared library: deeper is a folder, not a vocabulary.
    writeModule(dir, "audio", "a/b/too-deep", {
      plugin: { type: "vst3", name: "X" },
    });
    expect(Object.keys(loadModules(dir))).toEqual([]);
  });
});
