// `node preset` — what the graph's preset dropdown runs. A preset is a FILE under a presets tree,
// keyed by the module the node extends; through the dispatcher and asserting the files, for the
// reason bypass.test.ts gives. See packages/song/docs/userPresets.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setLibraryOverlays } from "@studio/song/sharedFolders";
import { listNodePresets } from "@studio/song-edit/presets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";

let root: string;
let home: string;
let dir: string;
const logs: string[] = [];
let reloaded = 0;
const homeBefore = process.env.STUDIO_HOME;

/** A lane through one compressor node, the compressor holding two engines in `@workspace`; one library `st0`. */
function song(node: string): void {
  root = mkdtempSync(join(tmpdir(), "td-preset-"));
  home = join(root, "home");
  mkdirSync(join(home, "libraries", "st0", "modules"), { recursive: true });
  process.env.STUDIO_HOME = home;
  dir = join(root, "song.st0");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "graph.yaml"),
    "modules:\n  gtr: [ comp ]\n  comp: [ OUT ]\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
  writeFileSync(join(dir, "nodes", "comp.yaml"), node, "utf8");
  const mod = join(root, "_modules", "audio", "compressor");
  for (const [at, body] of [
    ["", "engine: tracktion\n"],
    ["engines/tracktion", "plugin: { type: internal, name: compressor }\n"],
    [
      "engines/vari-mu",
      "plugin: { type: internal, name: airwindows_varimu }\n",
    ],
  ]) {
    mkdirSync(join(mod, at), { recursive: true });
    writeFileSync(join(mod, at, "module.yaml"), body, "utf8");
  }
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

const node = () => parse(readFileSync(join(dir, "nodes", "comp.yaml"), "utf8"));
const kept = (...p: string[]) =>
  join(root, "_presets", "workspace", "audio", "compressor", ...p);

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  song(
    'extends: "@workspace/audio/compressor"\nengines:\n  tracktion:\n    params: { Ratio: 4, "Attack ms": 10 }\n',
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (homeBefore === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = homeBefore;
});

describe("node preset", () => {
  it("saves a node's values under <ns>/<module path>/<name>.yaml in the workspace's _presets", async () => {
    await runCommand('node preset save comp "big squash"', host(), "cli");
    const file = kept("big squash.yaml");
    expect(existsSync(file)).toBe(true);
    expect(parse(readFileSync(file, "utf8"))).toEqual({
      engine: "tracktion",
      params: { Ratio: 4, "Attack ms": 10 },
    });
    // Nothing is written into the module's own folder any more.
    expect(
      existsSync(join(root, "_modules", "audio", "compressor", "presets.yaml")),
    ).toBe(false);
  });

  it("refuses a taken name, and update overwrites it with the node's current values", async () => {
    await runCommand("node preset save comp soft", host(), "cli");
    await runCommand("node preset save comp soft", host(), "cli");
    expect(logs.at(-1)).toMatch(/already exists/);
    writeFileSync(
      join(dir, "nodes", "comp.yaml"),
      'extends: "@workspace/audio/compressor"\nengines:\n  tracktion:\n    params: { Ratio: 2 }\n',
      "utf8",
    );
    await runCommand("node preset update comp workspace soft", host(), "cli");
    expect(parse(readFileSync(kept("soft.yaml"), "utf8")).params).toEqual({
      Ratio: 2,
    });
  });

  it("keeps a preset in a library only for an admin, who edits it", async () => {
    await runCommand("node preset save comp b-lib st0", host(), "cli");
    expect(
      existsSync(join(home, "libraries", "st0", "presets", "workspace")),
    ).toBe(false);
  });

  it("keeps a preset in a library, and lists every scope, workspace first", async () => {
    // An admin's own clone of `st0`, the one place its presets are written.
    setLibraryOverlays([{ name: "st0", root: join(home, "libraries", "st0") }]);
    await runCommand("node preset save comp b-lib st0", host(), "cli");
    setLibraryOverlays([]);
    await runCommand("node preset save comp a-ws", host(), "cli");
    expect(
      existsSync(
        join(
          home,
          "libraries",
          "st0",
          "presets",
          "workspace",
          "audio",
          "compressor",
          "b-lib.yaml",
        ),
      ),
    ).toBe(true);
    expect(listNodePresets(dir, "comp")).toEqual({
      ref: "@workspace/audio/compressor",
      presets: [
        { scope: "workspace", name: "a-ws" },
        { scope: "st0", name: "b-lib" },
      ],
      scopes: ["workspace", "st0"],
    });
  });

  it("applies a preset onto the node's file, on the engine that is on", async () => {
    mkdirSync(kept(), { recursive: true });
    writeFileSync(kept("hard.yaml"), "params:\n  Ratio: 10\n", "utf8");
    await runCommand("node preset apply comp workspace hard", host(), "cli");
    expect(node().engines.tracktion.params).toEqual({
      Ratio: 10,
      "Attack ms": 10,
    });
    expect(reloaded).toBe(1);
  });

  it("switches to the engine a preset was taken on before writing its values", async () => {
    mkdirSync(kept(), { recursive: true });
    writeFileSync(
      kept("glue.yaml"),
      "engine: vari-mu\nparams:\n  Drive: 0.3\n",
      "utf8",
    );
    await runCommand('node preset apply comp workspace "glue"', host(), "cli");
    expect(node().engine).toBe("vari-mu");
    expect(node().engines["vari-mu"].params).toEqual({ Drive: 0.3 });
    expect(node().engines.tracktion.params.Ratio).toBe(4);
  });

  it("keeps the base the node is on, so its values come back over the same state", async () => {
    const base = join(root, "_modules", "audio", "compressor", "base", "Pads");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "warm.fxp"), "CcnK", "utf8");
    writeFileSync(
      join(dir, "nodes", "comp.yaml"),
      'extends: "@workspace/audio/compressor"\nbase: "Pads/warm"\nengines:\n  tracktion:\n    params: { Ratio: 4 }\n',
      "utf8",
    );
    await runCommand('node preset save comp "warm squash"', host(), "cli");
    expect(parse(readFileSync(kept("warm squash.yaml"), "utf8")).base).toBe(
      "Pads/warm",
    );
  });

  it("switches the node to a preset's base, drops the values set over the old one, and reloads", async () => {
    const base = join(root, "_modules", "audio", "compressor", "base", "Pads");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "warm.fxp"), "CcnK", "utf8");
    mkdirSync(kept(), { recursive: true });
    writeFileSync(
      kept("warm.yaml"),
      'base: "Pads/warm"\nparams:\n  Ratio: 6\n',
      "utf8",
    );
    await runCommand("node preset apply comp workspace warm", host(), "cli");
    expect(node().base).toBe("Pads/warm");
    // The node's own values were set over the old base: only the preset's are left.
    expect(node().engines.tracktion.params).toEqual({ Ratio: 6 });
    expect(reloaded).toBe(1);
  });

  it("says so, and keeps the node's base, when the preset's base is not here", async () => {
    mkdirSync(kept(), { recursive: true });
    writeFileSync(
      kept("gone.yaml"),
      'base: "Pads/gone"\nparams:\n  Ratio: 3\n',
      "utf8",
    );
    await runCommand("node preset apply comp workspace gone", host(), "cli");
    expect(node().base).toBeUndefined();
    expect(node().engines.tracktion.params.Ratio).toBe(3);
    expect(logs.at(-1)).toMatch(/base 'Pads\/gone' is not here/);
  });

  it("lists and loads the presets of the module its attribute set swaps it for", async () => {
    // A second module with a patch, and the node's second set running as it.
    const synth = join(root, "_modules", "instruments", "synth");
    mkdirSync(join(synth, "base", "Pads"), { recursive: true });
    writeFileSync(
      join(synth, "module.yaml"),
      "plugin: { type: internal, name: synth }\n",
      "utf8",
    );
    writeFileSync(join(synth, "base", "Pads", "warm.fxp"), "CcnK", "utf8");
    writeFileSync(
      join(dir, "nodes", "comp.yaml"),
      'extends: "@workspace/audio/compressor"\nalternatives:\n  - { extends: "@workspace/instruments/synth" }\nalternative: "2"\n',
      "utf8",
    );
    const shelf = join(root, "_presets", "workspace", "instruments", "synth");
    mkdirSync(shelf, { recursive: true });
    writeFileSync(
      join(shelf, "Pads - warm.yaml"),
      'base: "Pads/warm"\n',
      "utf8",
    );
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
    expect(existsSync(join(root, "_presets", "evil.yaml"))).toBe(false);
  });
});
