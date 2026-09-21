import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadCurves } from "@studio/song/curves";
import { isFolderProject } from "@studio/song/folder";
import { loadGraph } from "@studio/song/graph";
import { exportSub, loadModules } from "@studio/song/loader";
import { compileNodeProject } from "@studio/song/nodeProject";
import { isProjectFolder } from "@studio/song/yaml/moduleIO";
import { ClipSchema } from "@studio/song-schema/yaml/entitySchemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  insertChainStep,
  setModuleAsset,
  setModuleBypass,
  setModuleParam,
} from "./projectEdit";

// A YAML project end to end — the loader, the compiler, the writers, over a shipped demo song.

const here = dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
// Three, not four: `song-edit/src` → the package → `packages/` → the repo root.
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");
const DEMO_MODULES = join(here, "..", "..", "..", "demos", "_modules");
// A module lives at `@workspace` now, in `_modules` BESIDE the project — not `dir` itself.
const SYNTH = ["..", "_modules", "instruments", "synth"];

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-yaml-"));
  dir = join(root, "synth-demo.st0");
  cpSync(SONG, dir, { recursive: true });
  cpSync(DEMO_MODULES, join(root, "_modules"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("loading", () => {
  it("reports a bad module with its file and the offending key", () => {
    // Closed: a module silently ignoring `paramz:` would be a knob that does nothing. A NODE is
    // what `loadModules` reads now — the shared module it extends is a different loader's business.
    writeFileSync(
      join(dir, "nodes", "lead.yaml"),
      'extends: "@workspace/instruments/synth"\nparamz: {}\n',
      "utf8",
    );
    expect(() => loadModules(dir, true)).toThrow(/invalid module\(s\)/);
    expect(() => loadModules(dir, true)).toThrow(/lead\.yaml/);
    expect(() => loadModules(dir, true)).toThrow(/paramz/);
  });

  it("reads the sequences and curves folders through one loader", () => {
    const seqs = Object.keys(exportSub(dir, "sequences"));
    const curves = Object.keys(exportSub(dir, "curves"));
    expect(seqs.length).toBeGreaterThan(0);
    expect(curves.sort()).toEqual(["sweep", "wobble"]);
  });

  it("reads a curve back through its own loader", () => {
    // The fixture has an LFO and a hand-drawn one; the two shapes are read differently.
    const curves = loadCurves(dir);
    expect(Object.keys(curves).sort()).toEqual(["sweep", "wobble"]);
    expect(curves.wobble).toMatchObject({ type: "lfo", polarity: "bipolar" });
    expect(curves.sweep.type).toBe("custom");
  });

  it("wants a source a clip can actually play", () => {
    // An empty source is a clip the timeline draws and the engine cannot sound.
    expect(ClipSchema.safeParse({ source: "kick.wav" }).success).toBe(true);
    expect(ClipSchema.safeParse({ source: "" }).success).toBe(false);
  });
});

describe("the writers", () => {
  it("changes one value and leaves the rest of the file alone", () => {
    const file = join(dir, ...SYNTH, "module.yaml");
    const authored =
      "# the lead\nplugin:\n  type: internal\n  name: 4osc\nparams:\n  Mix: 1\n";
    writeFileSync(file, authored, "utf8");

    setModuleParam(dir, "@workspace/instruments/synth", "Mix", 0.5);
    const after = readFileSync(file, "utf8");
    // The comment survives and exactly one line differs, so a knob drag is a one-line diff.
    expect(after).toContain("# the lead");
    expect(after).toContain("Mix: 0.5");
    expect(
      after.split("\n").filter((l, i) => l !== authored.split("\n")[i]),
    ).toHaveLength(1);
  });

  it("sets and clears a library asset", () => {
    const folder = join(root, "_modules", "audio", "cab");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "module.yaml"),
      "plugin:\n  type: internal\n  name: Impulse Response\n",
      "utf8",
    );

    setModuleAsset(dir, "@workspace/audio/cab", "ir", "ir/marshall.wav");
    expect(readFileSync(join(folder, "module.yaml"), "utf8")).toContain(
      "ir: ir/marshall.wav",
    );
    // Cleared, not emptied: `ir: ""` would be a value that means nothing.
    setModuleAsset(dir, "@workspace/audio/cab", "ir", null);
    expect(readFileSync(join(folder, "module.yaml"), "utf8")).not.toContain(
      "ir:",
    );
  });

  it("bypasses a module and reads it back through the graph", () => {
    const chain = Object.keys(loadGraph(dir).chains)[0];
    const step = loadGraph(dir).chains[chain].use[0].module;

    setModuleBypass(dir, step, true);
    expect(
      loadGraph(dir).chains[chain].use.find((s) => s.module === step)?.enabled,
    ).toBe(false);
    // …and off-then-on returns the file to what it was, so clicking twice leaves no diff.
    const file = join(dir, "graph.yaml");
    const bypassed = readFileSync(file, "utf8");
    setModuleBypass(dir, step, false);
    expect(readFileSync(file, "utf8")).not.toBe(bypassed);
    setModuleBypass(dir, step, true);
    expect(readFileSync(file, "utf8")).toBe(bypassed);
  });

  it("inserts a module into the arrow `node insert` names", () => {
    const chain = Object.keys(loadGraph(dir).chains)[0];
    const c = loadGraph(dir).chains[chain];
    const before = c.use.map((s) => s.module);
    // The arrow leaving the track: its source and whatever it feeds first.
    insertChainStep(dir, chain, before[0] ?? c.out[0].to, "fourosc");
    const after = loadGraph(dir).chains[chain].use.map((s) => s.module);
    expect(after[0]).toBe("fourosc");
    expect(after.slice(1)).toEqual(before);
  });
});

describe("a song is still a song", () => {
  it("is recognised as a project by every check that asks", () => {
    // None of these may look for `project.cue` BY NAME, or a converted song goes invisible.
    expect(existsSync(join(dir, "project.yaml"))).toBe(true);
    expect(isProjectFolder(dir)).toBe(true);
    expect(isFolderProject(dir)).toBe(true);
    expect(isFolderProject(join(dir, "project.yaml"))).toBe(true);
  });

  it("compiles to a project with its tracks, plugins and clips", () => {
    const doc = compileNodeProject(dir);
    expect(doc.tracks.map((t) => t.id).sort()).toEqual([
      "kit",
      "melody",
      "pad",
    ]);
    const melody = doc.tracks.find((t) => t.id === "melody");
    expect(melody?.plugins.some((p) => p.type === "4osc")).toBe(true);
  });
});
