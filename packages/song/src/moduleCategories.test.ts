// The optional CATEGORY level in a shared module folder: scanModules files a plugin that declares one at
// `<type>/<category>/<slug>`, and for a long time the READER stopped at `<type>/<name>` — so on a real
// 250-module folder 205 modules were invisible to every project. Writer and reader disagreeing is silent:
// a missing module looks exactly like one that was never installed.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModuleRefs } from "./loader";

/** A module folder holding the minimal generic module.yaml. */
function module_(
  root: string,
  rel: string,
  body = 'plugin: {type: "internal"}\n',
) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "module.yaml"), body, "utf8");
}

describe("shared module folder: category level", () => {
  let ws: string;
  let shared: string;
  let project: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-cat-"));
    shared = join(ws, "_modules");
    mkdirSync(shared, { recursive: true });
    project = join(ws, "song");
    mkdirSync(project, { recursive: true });
    // Both shapes the writer produces, side by side under one type folder.
    module_(shared, "audio/delay/adt"); // categorised
    module_(shared, "audio/genome"); // not
    module_(shared, "instruments/4osc");
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("keys a categorised module with the category in its ref", () => {
    // No engine catalogue: this asks what the FILES define, and the machine's scanned
    // plugins would drown a vocabulary of three.
    const refs = loadModuleRefs(project, ["../_modules"], {});
    expect(Object.keys(refs).sort()).toEqual([
      "@workspace/audio/delay/adt",
      "@workspace/audio/genome",
      "@workspace/instruments/4osc",
    ]);
  });

  it("descends exactly one level, and only past a folder with no module.yaml", () => {
    // A category is a filing convenience, not a nesting the format lets recurse: a
    // module.yaml two categories deep is NOT a module, or the ref space would be open
    // ended and `extends` could name something the writer never files.
    module_(shared, "audio/delay/tape/vintage");
    const refs = loadModuleRefs(project, ["../_modules"]);
    expect(Object.keys(refs)).not.toContain(
      "@workspace/audio/delay/tape/vintage",
    );
    // …and a folder that HAS a module.yaml is read as one, never descended into.
    module_(shared, "audio/comp");
    module_(shared, "audio/comp/inner");
    const again = loadModuleRefs(project, ["../_modules"]);
    expect(Object.keys(again)).toContain("@workspace/audio/comp");
    expect(Object.keys(again)).not.toContain("@workspace/audio/comp/inner");
  });

  it("still finds the preset beside a categorised module", () => {
    // The preset is named for the module's own FOLDER, not for its ref — getting that
    // wrong would look for `delay/adt.vstpreset`.
    writeFileSync(join(shared, "audio/delay/adt/adt.vstpreset"), "x", "utf8");
    const refs = loadModuleRefs(project, ["../_modules"]);
    const preset = refs["@workspace/audio/delay/adt"]?.preset;
    expect(preset).toBeTruthy();
    expect(existsSync(preset as string)).toBe(true);
  });
});
