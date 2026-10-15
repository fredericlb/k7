// COLD modules: ones that only work on audio already on disk, because they need the whole of
// their input before they can produce any of it. Normalisation is the case — the gain depends on
// the loudest sample, which may be the last one.
//
// What is pinned here is the RULE, in the one place it is decided: a cold module's chain must
// draw from a file. Not merely "not live" — a file specifically, since that is the only source
// whose whole length is knowable before playback. See docs/coldModules.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  carriesFileInput,
  coldPlacementError,
  isColdModule,
  loadGraph,
} from "./graph";
import { projectHints } from "./hints";
import { baseModuleRefs, loadModuleRefs, loadModules } from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import { writeLibraries, writeNode, writeYaml } from "./testSupport";

let ws: string;
let dir: string;

const SQUASH = "@workspace/audio/squash";

/** A project with one cold module (`squash`, at `@workspace`) and a chain over `chains`. */
function project(chains: string): void {
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  // A cold module is a genuine reusable base — a WORKSPACE module, extendable by nodes.
  writeYaml(join(ws, "_modules", "audio", "squash", "module.yaml"), {
    cold: true,
    plugin: { type: "jsdsp", name: "Normalize" },
    params: { Target: -1, Peak: 0 },
  });
  // "amp" is used once, plain — a NODE, bare in the graph exactly as a project module once was.
  writeNode(dir, "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  // OUT needs no file at all — a built-in sink name (docs/moduleTypes.md).
  writeFileSync(join(dir, "graph.yaml"), chains, "utf8");
}

/** …and a lane, so a chain sourced from one resolves. */
function track(id: string): void {
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", `${id}.yaml`),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-cold-"));
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("the cold flag", () => {
  it("is read off the module file", () => {
    project("modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n");
    track("gtr");
    const g = loadGraph(dir);
    expect(isColdModule(g.moduleRefs[SQUASH])).toBe(true);
    expect(isColdModule(g.moduleRefs.amp)).toBe(false);
  });

  it("is INHERITED, so a use of a cold module is cold", () => {
    // Not OWN_ONLY: a node states what it changes, and needing the whole file is not its choice.
    project("modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n");
    track("gtr");
    writeNode(dir, "master", {
      extends: SQUASH,
      params: { Target: -3 },
    });
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    expect(resolved.master.cold).toBe(true);
    // …and it reaches the graph, which is what the refusal reads.
    expect(isColdModule(loadGraph(dir).modules.master)).toBe(true);
  });
});

describe("adding one to a chain", () => {
  // A track of audio clips is NOT enough: what a lane plays is decided at playback.
  const FROM_TRACK = "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n";
  const FROM_FILE =
    "modules:\n  gtr: [ take ]\n  take: [ amp ]\n  amp: [ OUT ]\n";

  const withFileInput = (): void => {
    project(FROM_FILE);
    track("gtr");
    // io is a plain node directly — see docs/moduleTypes.md.
    writeNode(dir, "take", { io: "file", source: "clips/original.wav" });
  };

  it("refuses it over a chain with no file input, naming why", () => {
    project(FROM_TRACK);
    track("gtr");
    const g = loadGraph(dir);
    const err = coldPlacementError(g, g.moduleRefs[SQUASH], "squash", "amp");
    expect(err).toBeTruthy();
    expect(err).toContain("COLD");
    // The message has to say what to do, not only that it refused.
    expect(err).toContain("io: file");
  });

  it("allows it once the chain draws from a file", () => {
    withFileInput();
    const g = loadGraph(dir);
    expect(carriesFileInput(g, g.chains.gtr)).toBe(true);
    expect(
      coldPlacementError(g, g.moduleRefs[SQUASH], "squash", "amp"),
    ).toBeNull();
  });

  it("says nothing about a module that is not cold", () => {
    project(FROM_TRACK);
    track("gtr");
    const g = loadGraph(dir);
    expect(coldPlacementError(g, g.moduleRefs.amp, "amp", "amp")).toBeNull();
  });

  it("allows placing one wired to NOTHING", () => {
    // No input yet to be wrong about: the refusal comes when it is wired to something.
    project(FROM_TRACK);
    track("gtr");
    const g = loadGraph(dir);
    expect(
      coldPlacementError(g, g.moduleRefs[SQUASH], "squash", undefined),
    ).toBeNull();
  });

  it("refuses over a node that is in no chain at all", () => {
    project(FROM_TRACK);
    track("gtr");
    const g = loadGraph(dir);
    const err = coldPlacementError(
      g,
      g.moduleRefs[SQUASH],
      "squash",
      "nowhere",
    );
    expect(err).toContain("not part of a chain");
  });
});

describe("the cold/ folder", () => {
  let root: string;
  let song: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "td-coldfolder-"));
    song = join(root, "song");
    mkdirSync(song, { recursive: true });
    writeFileSync(join(song, "project.yaml"), "project:\n  name: s\n", "utf8");
    writeLibraries(root, {
      "cold/normalize": {
        cold: true,
        plugin: { type: "jsdsp", name: "Normalize" },
      },
      "audio/utility/gain": { plugin: { type: "jsdsp", name: "Gain" } },
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("loads a cold module under @<library>/cold/, audio in and out", () => {
    const m = loadModuleRefs(song)["@k7-core/cold/normalize"];
    expect(m?.category).toBe("cold");
    expect(m?.inputs.map((p) => p.type)).toEqual(["audio"]);
  });

  it("never suggests one: not in the picker, not in the chain completions", () => {
    const offered = baseModuleRefs(loadModuleRefs(song));
    expect(offered.filter((r) => r.startsWith("@k7-core/"))).toEqual([
      "@k7-core/audio/utility/gain",
    ]);
    expect(projectHints(song).modules).not.toContain("@k7-core/cold/normalize");
  });
});
