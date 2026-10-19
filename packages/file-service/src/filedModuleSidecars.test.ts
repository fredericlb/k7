// `/module-ui` answers for a module FILED under a category folder.
//
// The route turns a path into a module ref and 400s when it cannot. A `localModuleRef` that
// matches exactly four path segments reads `modules/audio/amps/neural-amp-modeler/module.k7x`
// as "not a module file" — a 400 for a file sitting plainly in the tree, and with it no panel.
// It stays invisible wherever a project's own modules are flat; a bench whose `modules/` mirrors
// a catalogue's filing is where they are not.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-filed-sidecar-"));
  const proj = join(root, "song.k7");
  mkdirSync(proj, { recursive: true });
  writeDoc(join(proj, "project.k7x"), { project: { name: "song" } });
  writeFileSync(join(proj, "graph.k7x"), "modules({})\n", "utf8");
  writeDoc(join(proj, "modules/audio/reverb/module.k7x"), {
    plugin: { type: "vst3", name: "R" },
  });
  writeDoc(join(proj, "modules/audio/amps/neural-amp-modeler/module.k7x"), {
    plugin: { type: "vst3", name: "NAM" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.k7");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a module filed one level deep", () => {
  const FILED = "song.k7/modules/audio/amps/neural-amp-modeler/module.k7x";
  const FLAT = "song.k7/modules/audio/reverb/module.k7x";

  it("has a panel, keyed by the ref its filing gives it", () => {
    const ui = ws.moduleUi(FILED);
    expect(ui.ref).toBe("audio/amps/neural-amp-modeler");
    // The sidecar sits BESIDE module.k7x, wherever that is.
    expect(ui.path).toContain("amps/neural-amp-modeler");
  });

  it("still answers for a flat module, and still refuses a non-module", () => {
    expect(ws.moduleUi(FLAT).ref).toBe("audio/reverb");
    expect(() => ws.moduleUi("song.k7/graph.k7x")).toThrow(/not a module file/);
  });
});
