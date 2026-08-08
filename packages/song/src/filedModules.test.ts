// A project's own `modules/` may FILE its modules one level deep — `audio/amps/neural-amp-modeler`
// — exactly as a shared library always could. Two walkers over one vocabulary disagreed:
// `readModuleTree` (the médiathèque, `_modules`) recursed, `loadModules` (the project's own) did
// not, and a folder with no `module.yaml` was skipped in SILENCE. So a filed module was not an
// error, it simply was not there — and every symptom described something else.
//
// It could not bite while a project's modules were always flat. The module bench, whose
// `modules/` is a mirror of the médiathèque's catalogue, is the first project where they are not.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules } from "./loader";
import { moduleKeyFromPath } from "./moduleTypes";
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
    // `file` is what `moduleRefOf` turns into a ref, so it carries the filing too — the ref of
    // this module is `audio/amps/neural-amp-modeler`, which is what its key must resolve to.
    expect(mods["amps/neural-amp-modeler"].file).toBe(
      "amps/neural-amp-modeler",
    );
    expect(mods["amps/neural-amp-modeler"].category).toBe("audio");
  });

  it("finds its .vstpreset beside its own module.yaml, not under the category", () => {
    writeModule(dir, "audio", "amps/neural-amp-modeler", {
      plugin: { type: "vst3", name: "NAM" },
    });
    // Named after the module's OWN folder. Joining the whole key would have looked for
    // `amps/neural-amp-modeler.vstpreset` inside the module's folder — a path with a
    // directory in it that does not exist, so the preset would simply never be found.
    const preset = join(
      dir,
      "modules/audio/amps/neural-amp-modeler/neural-amp-modeler.vstpreset",
    );
    writeFileSync(preset, "x");

    expect(loadModules(dir)["amps/neural-amp-modeler"].preset).toBe(preset);
  });

  it("is named the same way by a browser reading only the path", () => {
    // l8's builder has no loader — it maps the open FILE to the key a chain writes, so that it
    // can find the plugin the project loaded. Spelled differently from `loadModules`, it would
    // look up `neural-amp-modeler`, find nothing, and report a module the project plainly has
    // as one it does not. Same answer, from the two ends, is the contract.
    writeModule(dir, "audio", "amps/neural-amp-modeler", {
      plugin: { type: "vst3", name: "NAM" },
    });
    const key = Object.keys(loadModules(dir))[0];
    expect(
      moduleKeyFromPath(
        "banc.l8/modules/audio/amps/neural-amp-modeler/module.yaml",
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
    expect(moduleKeyFromPath("banc.l8/chains.yaml")).toBeNull();
    expect(moduleKeyFromPath("modules/nonsense/x/module.yaml")).toBeNull();
  });

  it("still ignores a folder that is neither a module nor a filing of one", () => {
    // Two levels down is not a module. The rule is ONE level of filing, as it is for a shared
    // library — deeper is a folder somebody put there, not a vocabulary.
    writeModule(dir, "audio", "a/b/too-deep", {
      plugin: { type: "vst3", name: "X" },
    });
    expect(Object.keys(loadModules(dir))).toEqual([]);
  });
});
