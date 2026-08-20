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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCurves } from "../curves";
import { isFolderProject } from "../folder";
import { loadGraph } from "../graph";
import { exportSub, loadModules } from "../loader";
import { compileNodeProject } from "../nodeProject";
import {
  insertChainStep,
  setModuleAsset,
  setModuleBypass,
  setModuleParam,
} from "../projectEdit";
import { ClipSchema } from "./entitySchemas";
import { isProjectFolder } from "./moduleIO";

// A YAML project, end to end: the loader, the compiler, the writers, and the "is this a
// project" checks every surface asks.
//
// This was mixedFormat.test.ts — the tests that had to pass before the CUE→YAML move could
// be wired in. The half that only ever described the TRANSITION (a .cue and a .yaml in one
// folder, the migration's own output, the .cue kept as a backup) went with the transition;
// what is left is the behaviour a song still relies on, and no longer mentions a format it
// only has one of.
//
// The fixture is a shipped demo song, copied per test, so these read the same files a user's
// song is made of rather than a minimal thing built to pass.

const here = dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.st0",
);
const SYNTH = ["modules", "instruments", "synth"];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-yaml-"));
  cpSync(SONG, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loading", () => {
  it("reports a bad module with its file and the offending key", () => {
    // Closed, like the CUE structs were: a module that silently ignored `paramz:` would be
    // a knob that does nothing, with nothing to read that says why.
    writeFileSync(join(dir, ...SYNTH, "module.yaml"), "paramz: {}\n", "utf8");
    expect(() => loadModules(dir, true)).toThrow(/invalid module\(s\)/);
    expect(() => loadModules(dir, true)).toThrow(/module\.yaml/);
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
    // An empty source is a clip the timeline draws and the engine can't sound — the failure
    // would be silence with nothing to read.
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

    setModuleParam(dir, "synth", "Mix", 0.5);
    const after = readFileSync(file, "utf8");
    // The comment survives, and exactly one line differs — which is what keeps a knob drag
    // to a one-line diff instead of a reformatted file.
    expect(after).toContain("# the lead");
    expect(after).toContain("Mix: 0.5");
    expect(
      after.split("\n").filter((l, i) => l !== authored.split("\n")[i]),
    ).toHaveLength(1);
  });

  it("sets and clears a library asset", () => {
    const folder = join(dir, "modules", "audio", "cab");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "module.yaml"),
      "plugin:\n  type: internal\n  name: Impulse Response\n",
      "utf8",
    );

    setModuleAsset(dir, "cab", "ir", "ir/marshall.wav");
    expect(readFileSync(join(folder, "module.yaml"), "utf8")).toContain(
      "ir: ir/marshall.wav",
    );
    // Cleared, not emptied: a convolver with no IR is a legitimate state, and `ir: ""`
    // would be a value that means nothing.
    setModuleAsset(dir, "cab", "ir", null);
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
    // …and off-then-on returns the file to what it was, which is the property the graph's
    // bypass button relies on: clicking twice leaves no diff.
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
    // These all used to look for `project.cue` BY NAME. A converted song dropped out of the
    // workspace picker and the file tree's project markers — present on disk, invisible to
    // the app — until each of them was taught to ask for the project FILE.
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
