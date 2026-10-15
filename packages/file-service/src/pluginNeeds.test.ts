// What a project asks of its engine. Too little and a project missing its synth scores 100 on a
// machine without it; too much (a jsdsp module, a shader) and every engine looks incompatible.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pluginNeedsOf, projectCompatOf } from "./pluginNeeds";

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "needs-"));
  dir = join(root, "song.k7");
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

  // A render lets an engine without the VST PLAY the track, not edit it: still a compatibility loss.
  it("still counts a plugin baked into a freeze", () => {
    node("lead", "instruments", "plugin:\n  type: vst3\n  name: Serum\n");
    node("synth", "instruments", "plugin:\n  type: internal\n  name: 4osc\n");
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  lead: [ OUT ]\n  synth: [ OUT ]\n",
    );
    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(join(dir, "renders", "lead.wav"), "");
    writeFileSync(
      join(dir, "nodes", "lead.yaml"),
      'extends: "@workspace/instruments/lead"\nfrozen: renders/lead.wav\n',
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

describe("projectCompatOf", () => {
  beforeEach(() => {
    node("synth", "instruments", "plugin:\n  type: internal\n  name: 4osc\n");
    node("lead", "instruments", "plugin:\n  type: vst3\n  name: Serum\n");
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  synth: [ OUT ]\n  lead: [ OUT ]\n",
    );
  });

  // The engine's machine scores against its own scan: a built-in by type name, a VST by name.
  it("scores the project against the engine's scan", () => {
    expect(
      projectCompatOf(dir, [{ format: "internal", name: "4OSC", id: "4osc" }]),
    ).toEqual({ score: 50, missing: [{ format: "vst3", name: "Serum" }] });
  });

  // No scan yet is not "nothing installed": null, so no engine is ranked down for it.
  it("cannot say against an empty scan", () => {
    expect(projectCompatOf(dir, [])).toBeNull();
  });
});
