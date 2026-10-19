// `node preset` — what the graph's preset dropdown runs. A preset is a FILE under a presets tree,
// keyed by the module the node extends; through the dispatcher and asserting the files, for the
// reason bypass.test.ts gives. See packages/song/docs/userPresets.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setLibraryOverlays } from "@studio/song/sharedFolders";
import { writeDoc, writeLane, writeNode } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { listNodePresets } from "@studio/song-edit/presets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let home: string;
let dir: string;
const logs: string[] = [];
let reloaded = 0;
const homeBefore = process.env.STUDIO_HOME;

/** A lane through one compressor node, the compressor holding two engines in `@workspace`; one library `k7-core`. */
function song(node: Record<string, unknown>): void {
  root = mkdtempSync(join(tmpdir(), "td-preset-"));
  home = join(root, "home");
  mkdirSync(join(home, "libraries", "k7-core", "modules"), { recursive: true });
  process.env.STUDIO_HOME = home;
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeDoc(join(dir, "graph.k7x"), {
    modules: { gtr: ["comp"], comp: ["OUT"] },
  });
  writeLane(dir, "gtr", "track", { events: [] });
  writeNode(dir, "comp", node);
  const mod = join(root, "_modules", "audio", "compressor");
  for (const [at, body] of [
    ["", { engine: "tracktion" }],
    ["engines/tracktion", { plugin: { type: "internal", name: "compressor" } }],
    [
      "engines/vari-mu",
      { plugin: { type: "internal", name: "airwindows_varimu" } },
    ],
  ] as const)
    writeDoc(join(mod, at, "module.k7x"), body);
}

const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [], masterPlugins: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;

const COMP = "@workspace/audio/compressor";
// biome-ignore lint/suspicious/noExplicitAny: the test reads arbitrary depths of the node's data.
const node = (): any => wsData(join(dir, "nodes", "comp.k7x"));
const kept = (...p: string[]) =>
  join(root, "_presets", "workspace", "audio", "compressor", ...p);

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  song({
    extends: COMP,
    engines: { tracktion: { params: { Ratio: 4, "Attack ms": 10 } } },
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (homeBefore === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = homeBefore;
});

describe("node preset", () => {
  it("saves a node's values under <ns>/<module path>/<name>.k7x in the workspace's _presets", async () => {
    await runCommand('node preset save comp "big squash"', host(), "cli");
    const file = kept("big squash.k7x");
    expect(existsSync(file)).toBe(true);
    expect(wsData(file)).toEqual({
      engine: "tracktion",
      params: { Ratio: 4, "Attack ms": 10 },
    });
    // Nothing is written into the module's own folder.
    expect(
      existsSync(join(root, "_modules", "audio", "compressor", "presets.k7x")),
    ).toBe(false);
  });

  it("refuses a taken name, and update overwrites it with the node's current values", async () => {
    await runCommand("node preset save comp soft", host(), "cli");
    await runCommand("node preset save comp soft", host(), "cli");
    expect(logs.at(-1)).toMatch(/already exists/);
    writeNode(dir, "comp", {
      extends: COMP,
      engines: { tracktion: { params: { Ratio: 2 } } },
    });
    await runCommand("node preset update comp workspace soft", host(), "cli");
    expect(wsData(kept("soft.k7x")).params).toEqual({ Ratio: 2 });
  });

  it("keeps a preset in a library only for an admin, who edits it", async () => {
    await runCommand("node preset save comp b-lib k7-core", host(), "cli");
    expect(
      existsSync(join(home, "libraries", "k7-core", "presets", "workspace")),
    ).toBe(false);
  });

  it("keeps a preset in a library, and lists every scope, workspace first", async () => {
    // An admin's own clone of `k7`, the one place its presets are written.
    setLibraryOverlays([
      { name: "k7-core", root: join(home, "libraries", "k7-core") },
    ]);
    await runCommand("node preset save comp b-lib k7-core", host(), "cli");
    setLibraryOverlays([]);
    await runCommand("node preset save comp a-ws", host(), "cli");
    expect(
      existsSync(
        join(
          home,
          "libraries",
          "k7-core",
          "presets",
          "workspace",
          "audio",
          "compressor",
          "b-lib.k7x",
        ),
      ),
    ).toBe(true);
    expect(listNodePresets(dir, "comp")).toEqual({
      ref: COMP,
      presets: [
        { scope: "workspace", name: "a-ws" },
        { scope: "k7-core", name: "b-lib" },
      ],
      scopes: ["workspace", "account", "k7-core"],
    });
  });

  it("applies a preset onto the node's file, on the engine that is on", async () => {
    writeDoc(kept("hard.k7x"), { params: { Ratio: 10 } });
    await runCommand("node preset apply comp workspace hard", host(), "cli");
    expect(node().engines.tracktion.params).toEqual({
      Ratio: 10,
      "Attack ms": 10,
    });
    expect(reloaded).toBe(1);
  });

  it("switches to the engine a preset was taken on before writing its values", async () => {
    writeDoc(kept("glue.k7x"), { engine: "vari-mu", params: { Drive: 0.3 } });
    await runCommand('node preset apply comp workspace "glue"', host(), "cli");
    expect(node().engine).toBe("vari-mu");
    expect(node().engines["vari-mu"].params).toEqual({ Drive: 0.3 });
    expect(node().engines.tracktion.params.Ratio).toBe(4);
  });

  it("keeps the base the node is on, so its values come back over the same state", async () => {
    const base = join(root, "_modules", "audio", "compressor", "base", "Pads");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "warm.fxp"), "CcnK", "utf8");
    writeNode(dir, "comp", {
      extends: COMP,
      base: "Pads/warm",
      engines: { tracktion: { params: { Ratio: 4 } } },
    });
    await runCommand('node preset save comp "warm squash"', host(), "cli");
    expect(wsData(kept("warm squash.k7x")).base).toBe("Pads/warm");
  });

  it("switches the node to a preset's base, drops the values set over the old one, and reloads", async () => {
    const base = join(root, "_modules", "audio", "compressor", "base", "Pads");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "warm.fxp"), "CcnK", "utf8");
    writeDoc(kept("warm.k7x"), { base: "Pads/warm", params: { Ratio: 6 } });
    await runCommand("node preset apply comp workspace warm", host(), "cli");
    expect(node().base).toBe("Pads/warm");
    // The node's own values were set over the old base: only the preset's are left.
    expect(node().engines.tracktion.params).toEqual({ Ratio: 6 });
    expect(reloaded).toBe(1);
  });

  it("says so, and keeps the node's base, when the preset's base is not here", async () => {
    writeDoc(kept("gone.k7x"), { base: "Pads/gone", params: { Ratio: 3 } });
    await runCommand("node preset apply comp workspace gone", host(), "cli");
    expect(node().base).toBeUndefined();
    expect(node().engines.tracktion.params.Ratio).toBe(3);
    expect(logs.at(-1)).toMatch(/base 'Pads\/gone' is not here/);
  });

  it("lists and loads the presets of the module its attribute set swaps it for", async () => {
    // A second module with a patch, and the node's second set running as it.
    const synth = join(root, "_modules", "instruments", "synth");
    writeDoc(join(synth, "module.k7x"), {
      plugin: { type: "internal", name: "synth" },
    });
    mkdirSync(join(synth, "base", "Pads"), { recursive: true });
    writeFileSync(join(synth, "base", "Pads", "warm.fxp"), "CcnK", "utf8");
    writeNode(dir, "comp", {
      extends: COMP,
      alternatives: [{ extends: "@workspace/instruments/synth" }],
      alternative: "2",
    });
    const shelf = join(root, "_presets", "workspace", "instruments", "synth");
    writeDoc(join(shelf, "Pads - warm.k7x"), { base: "Pads/warm" });
    expect(listNodePresets(dir, "comp")).toMatchObject({
      ref: "@workspace/instruments/synth",
      presets: [{ scope: "workspace", name: "Pads - warm" }],
    });
    await runCommand(
      'node preset apply comp workspace "Pads - warm"',
      host(),
      "cli",
    );
    // Into the set that is on — a top-level base is not what a swapped node reads.
    expect(node().alternatives[0].base).toBe("Pads/warm");
    expect(node().base).toBeUndefined();
  });

  it("refuses a name that would leave the module's folder", async () => {
    await runCommand('node preset save comp "../../evil"', host(), "cli");
    expect(logs.at(-1)).toMatch(/invalid preset name/);
    expect(existsSync(join(root, "_presets", "evil.k7x"))).toBe(false);
  });
});
