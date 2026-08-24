// `/module-ui` and `/module-presets` answer for a module FILED under a category folder.
//
// Both routes turn a path into a module ref and 400 when they cannot. A `localModuleRef` that
// matches exactly four path segments reads `modules/audio/amps/neural-amp-modeler/module.yaml`
// as "not a module file" — a 400 for a file sitting plainly in the tree, and with it no panel
// and no preset shelf. It stays invisible wherever a project's own modules are flat; a bench
// whose `modules/` mirrors a catalogue's filing is where they are not.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-filed-sidecar-"));
  const proj = join(root, "song.st0");
  mkdirSync(proj, { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeFileSync(join(proj, "graph.yaml"), "modules: {}\n", "utf8");
  writeYaml(join(proj, "modules/audio/reverb/module.yaml"), {
    plugin: { type: "vst3", name: "R" },
  });
  writeYaml(join(proj, "modules/audio/amps/neural-amp-modeler/module.yaml"), {
    plugin: { type: "vst3", name: "NAM" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a module filed one level deep", () => {
  const FILED = "song.st0/modules/audio/amps/neural-amp-modeler/module.yaml";
  const FLAT = "song.st0/modules/audio/reverb/module.yaml";

  it("has a panel, keyed by the ref its filing gives it", () => {
    const ui = ws.moduleUi(FILED);
    expect(ui.ref).toBe("audio/amps/neural-amp-modeler");
    // The sidecar sits BESIDE module.yaml, wherever that is.
    expect(ui.path).toContain("amps/neural-amp-modeler");
  });

  it("has a preset shelf too", () => {
    expect(ws.modulePresets(FILED).ref).toBe("audio/amps/neural-amp-modeler");
  });

  it("still answers for a flat module, and still refuses a non-module", () => {
    expect(ws.moduleUi(FLAT).ref).toBe("audio/reverb");
    expect(() => ws.moduleUi("song.st0/graph.yaml")).toThrow(
      /not a module file/,
    );
  });
});
