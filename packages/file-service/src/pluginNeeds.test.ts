// What a project asks of its engine. Too little and a project missing its synth scores 100 on a
// machine without it; too much (a jsdsp module, a shader) and every engine looks incompatible.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pluginNeedsOf, projectCompatOf } from "./pluginNeeds";

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "needs-"));
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "n" } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A module at `@workspace`, and a node of the project using it. */
function node(name: string, category: string, type: string, plugin: string) {
  writeDoc(join(root, "_modules", category, name, "module.k7x"), {
    plugin: { type, name: plugin },
  });
  writeDoc(join(dir, "nodes", `${name}.k7x`), {
    extends: `@workspace/${category}/${name}`,
  });
}

const graph = (modules: Record<string, string[]>) =>
  writeDoc(join(dir, "graph.k7x"), { modules });

describe("pluginNeedsOf", () => {
  it("lists internal and external plugins once each, and nothing built from source", () => {
    node("synth", "instruments", "internal", "4osc");
    node("lead", "instruments", "VST3", "Serum");
    node("verb", "audio", "vst3", "Serum");
    node("dsp", "audio", "jsdsp", "dsp");
    graph({ synth: ["verb"], lead: ["dsp"], verb: ["OUT"], dsp: ["OUT"] });

    expect(pluginNeedsOf(dir)).toEqual([
      { format: "internal", name: "4osc" },
      { format: "vst3", name: "Serum" },
    ]);
  });

  // A render lets an engine without the VST PLAY the track, not edit it: still a compatibility loss.
  it("still counts a plugin baked into a freeze", () => {
    node("lead", "instruments", "vst3", "Serum");
    node("synth", "instruments", "internal", "4osc");
    graph({ lead: ["OUT"], synth: ["OUT"] });
    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(join(dir, "renders", "lead.wav"), "");
    writeDoc(join(dir, "nodes", "lead.k7x"), {
      extends: "@workspace/instruments/lead",
      frozen: "renders/lead.wav",
    });
    expect(pluginNeedsOf(dir)).toEqual([
      { format: "internal", name: "4osc" },
      { format: "vst3", name: "Serum" },
    ]);
  });

  it("is empty for a project that loads no plugin", () => {
    graph({});
    expect(pluginNeedsOf(dir)).toEqual([]);
  });
});

describe("projectCompatOf", () => {
  beforeEach(() => {
    node("synth", "instruments", "internal", "4osc");
    node("lead", "instruments", "vst3", "Serum");
    graph({ synth: ["OUT"], lead: ["OUT"] });
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
