// What a project asks of its engine. Too little and a project missing its synth scores 100 on a
// machine without it; too much (a jsdsp module, a shader) and every engine looks incompatible.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pluginNeedsOf } from "./pluginNeeds";

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "needs-"));
  dir = join(root, "song.st0");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "n"\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A module at `@workspace`, and a node of the project using it. */
function node(name: string, category: string, body: string) {
  mkdirSync(join(root, "_modules", category, name), { recursive: true });
  writeFileSync(join(root, "_modules", category, name, "module.yaml"), body);
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", `${name}.yaml`),
    `extends: "@workspace/${category}/${name}"\n`,
  );
}

describe("pluginNeedsOf", () => {
  it("lists internal and external plugins once each, and nothing built from source", () => {
    node("synth", "instruments", "plugin:\n  type: internal\n  name: 4osc\n");
    node("lead", "instruments", "plugin:\n  type: VST3\n  name: Serum\n");
    node("verb", "audio", "plugin:\n  type: vst3\n  name: Serum\n");
    node("dsp", "audio", "plugin:\n  type: jsdsp\n  name: dsp\n");
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  synth: [ verb ]\n  lead: [ dsp ]\n  verb: [ OUT ]\n  dsp: [ OUT ]\n",
    );

    expect(pluginNeedsOf(dir)).toEqual([
      { format: "internal", name: "4osc" },
      { format: "vst3", name: "Serum" },
    ]);
  });

  it("is empty for a project that loads no plugin", () => {
    writeFileSync(join(dir, "graph.yaml"), "modules: {}\n");
    expect(pluginNeedsOf(dir)).toEqual([]);
  });
});
