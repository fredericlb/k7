// The optional CATEGORY level in a shared module folder: scanModules files a plugin that declares one at
// `<type>/<category>/<slug>`, and the READER has to descend that far — stopping at `<type>/<name>` hides
// every categorised module from every project. Writer and reader disagreeing is silent: a missing module
// looks exactly like one that was never installed.

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
import { writeDoc } from "./testSupport";

/** A module folder holding the minimal generic module.k7x. */
function module_(root: string, rel: string) {
  writeDoc(join(root, rel, "module.k7x"), { plugin: { type: "internal" } });
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
    // No engine catalogue: the machine's scanned plugins would drown a vocabulary of three.
    const refs = loadModuleRefs(project, {});
    // Minus `@meta/…`: the built-in doc module answers whatever is on disk.
    expect(
      Object.keys(refs)
        .filter((r) => !r.startsWith("@meta/"))
        .sort(),
    ).toEqual([
      "@workspace/audio/delay/adt",
      "@workspace/audio/genome",
      "@workspace/instruments/4osc",
    ]);
  });

  it("descends exactly one level, and only past a folder with no module.k7x", () => {
    // A category does not recurse, or the ref space is open ended and `extends` names anything.
    module_(shared, "audio/delay/tape/vintage");
    const refs = loadModuleRefs(project);
    expect(Object.keys(refs)).not.toContain(
      "@workspace/audio/delay/tape/vintage",
    );
    // …and a folder that HAS a module.k7x is read as one, never descended into.
    module_(shared, "audio/comp");
    module_(shared, "audio/comp/inner");
    const again = loadModuleRefs(project);
    expect(Object.keys(again)).toContain("@workspace/audio/comp");
    expect(Object.keys(again)).not.toContain("@workspace/audio/comp/inner");
  });

  it("still finds the preset beside a categorised module", () => {
    // Named for the module's own FOLDER, not its ref, which would seek `delay/adt.vstpreset`.
    writeFileSync(join(shared, "audio/delay/adt/adt.vstpreset"), "x", "utf8");
    const refs = loadModuleRefs(project);
    const preset = refs["@workspace/audio/delay/adt"]?.preset;
    expect(preset).toBeTruthy();
    expect(existsSync(preset as string)).toBe(true);
  });
});
