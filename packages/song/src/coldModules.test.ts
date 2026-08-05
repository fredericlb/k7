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
import { loadModuleRefs, loadModules } from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import { writeInstance, writeModule } from "./testSupport";

let dir: string;

/** A project with one cold module (`squash`) and a chain over `chains`. */
function project(chains: string): void {
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeModule(dir, "audio", "squash", {
    cold: true,
    plugin: { type: "jsdsp", name: "Normalize" },
    params: { Target: -1, Peak: 0 },
  });
  writeModule(dir, "audio", "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  writeModule(dir, "io", "OUT", { io: "out" });
  writeFileSync(join(dir, "chains.yaml"), chains, "utf8");
}

/** …and a track, so a chain sourced from one resolves. */
function track(id: string): void {
  mkdirSync(join(dir, "tracks"), { recursive: true });
  writeFileSync(
    join(dir, "tracks", `${id}.yaml`),
    "type: single\ncontentType: audio\nclips: []\n",
    "utf8",
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-cold-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the cold flag", () => {
  it("is read off the module file", () => {
    project("tracks:\n  gtr: [ amp ]\nmodules:\n  amp: [ OUT ]\n");
    track("gtr");
    const g = loadGraph(dir);
    expect(isColdModule(g.moduleRefs["audio/squash"])).toBe(true);
    expect(isColdModule(g.moduleRefs["audio/amp"])).toBe(false);
  });

  it("is INHERITED, so a use of a cold module is cold", () => {
    // The whole reason it is not in moduleResolve's OWN_ONLY. An instance states only what it
    // changes, and "this is still the thing that needs the whole file" is not a choice it makes.
    project("tracks:\n  gtr: [ amp ]\nmodules:\n  amp: [ OUT ]\n");
    track("gtr");
    writeInstance(dir, "master", {
      extends: "@project/audio/squash",
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
  // The two shapes the rule distinguishes. A track of audio clips is NOT enough: a chain fed by
  // a lane is fed by whatever that lane plays, which is decided at playback.
  const FROM_TRACK = "tracks:\n  gtr: [ amp ]\nmodules:\n  amp: [ OUT ]\n";
  const FROM_FILE =
    "tracks:\n  gtr: [ take ]\nmodules:\n  take: [ amp ]\n  amp: [ OUT ]\n";

  const withFileInput = (): void => {
    project(FROM_FILE);
    track("gtr");
    writeModule(dir, "io", "FILE", { io: "file" });
    writeInstance(dir, "take", {
      extends: "@project/FILE",
      source: "clips/original.wav",
    });
  };

  it("refuses it over a chain with no file input, naming why", () => {
    project(FROM_TRACK);
    track("gtr");
    const g = loadGraph(dir);
    const err = coldPlacementError(
      g,
      g.moduleRefs["audio/squash"],
      "squash",
      "amp",
    );
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
      coldPlacementError(g, g.moduleRefs["audio/squash"], "squash", "amp"),
    ).toBeNull();
  });

  it("says nothing about a module that is not cold", () => {
    project(FROM_TRACK);
    track("gtr");
    const g = loadGraph(dir);
    expect(
      coldPlacementError(g, g.moduleRefs["audio/amp"], "amp", "amp"),
    ).toBeNull();
  });

  it("allows placing one wired to NOTHING", () => {
    // There is no input yet to be wrong about, and refusing here would refuse to write a module
    // you are about to give a file to. The refusal comes when it is wired to something.
    project(FROM_TRACK);
    track("gtr");
    const g = loadGraph(dir);
    expect(
      coldPlacementError(g, g.moduleRefs["audio/squash"], "squash", undefined),
    ).toBeNull();
  });

  it("refuses over a node that is in no chain at all", () => {
    project(FROM_TRACK);
    track("gtr");
    const g = loadGraph(dir);
    const err = coldPlacementError(
      g,
      g.moduleRefs["audio/squash"],
      "squash",
      "nowhere",
    );
    expect(err).toContain("not part of a chain");
  });
});
