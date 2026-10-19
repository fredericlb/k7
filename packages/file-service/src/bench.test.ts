// The BENCH — a live rig seeded with a library chain — and the guard on library writes. What is
// proved: it opens, it keeps nothing of the rig, it names no library to edit; a library module is
// written into an admin's own clone and never the server's, and refused to anyone else.

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
import { rootDir } from "@studio/engine-client/paths";
import { setLibraryOverlays } from "@studio/song/sharedFolders";
import { BENCH_PROJECT, benchProject } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureBench } from "./bench.ts";
import { Workspace } from "./workspace.ts";
import { listWorkspaces } from "./workspaces.ts";

const EMAIL = "someone@example.test";

/** The package-wide pin from vitest.config.ts, put back after each test rather than deleted. */
const PINNED_HOME = process.env.STUDIO_HOME;
let home: string;

const benchRoot = (): string => join(rootDir(), BENCH_WORKSPACE);
const benchDir = (): string => join(benchRoot(), BENCH_PROJECT);
/** The server's clone, read-only — under `$STUDIO_HOME/libraries` when no hub names another. */
const libraryDir = (): string => join(home, "libraries", "k7-core");
const libraryChain = (): string => join(libraryDir(), "chains/live/vocals");
/** An admin's own clone of `k7`, the one a library write may reach. */
const editClone = (): string => join(home, "library-edits", "k7-core");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-bench-home-"));
  // Off the real machine: this test writes library checkouts, and the user's own are not fixtures.
  process.env.STUDIO_HOME = home;
  // The `k7-core` library, laid out by hand where the hub would have cloned it.
  mkdirSync(join(libraryChain(), "nodes"), { recursive: true });
  mkdirSync(join(libraryDir(), "modules/audio/comp"), { recursive: true });
  writeFileSync(
    join(libraryDir(), "modules/audio/comp/module.k7x"),
    'plugin({ type: "internal", name: "Compressor" })\n',
  );
  writeFileSync(
    join(libraryChain(), "graph.k7x"),
    '// Voix live.\nmodules({\n  "@in": ["comp"],\n  comp: ["@out"],\n})\n',
    "utf8",
  );
  writeFileSync(
    join(libraryChain(), "nodes", "comp.k7x"),
    'extends("@k7-core/audio/comp")\n',
  );
  mkdirSync(join(editClone(), "modules"), { recursive: true });
});

afterEach(() => {
  setLibraryOverlays([]);
  process.env.STUDIO_HOME = PINNED_HOME;
  rmSync(home, { recursive: true, force: true });
});

const openChainBench = () => ensureBench(EMAIL, benchProject("live/vocals"));

describe("the bench", () => {
  it("opens on a live rig seeded with the chain", async () => {
    const { workspace, project } = await openChainBench();
    expect(workspace).toBe(BENCH_WORKSPACE);
    expect(project).toBe(BENCH_PROJECT);
    const graph = readFileSync(join(benchDir(), "graph.k7x"), "utf8");
    expect(graph).toContain("IN:");
    expect(existsSync(join(benchDir(), "surfaces"))).toBe(false);
  });

  it("is not one of the workspaces the home page lists", async () => {
    mkdirSync(join(rootDir(), "songs"), { recursive: true });
    await openChainBench();
    expect(existsSync(benchRoot())).toBe(true);
    expect(listWorkspaces(EMAIL).map((w) => w.name)).toEqual(["songs"]);
  });

  it("throws away what was wired on it, at the next open", async () => {
    await openChainBench();
    const ws = new Workspace(benchRoot());
    ws.setActiveProject(BENCH_PROJECT);
    ws.write(
      `${BENCH_PROJECT}/graph.k7x`,
      'modules({ IN: ["reverb"], reverb: ["MIX"] })\n',
    );
    await openChainBench();
    const graph = readFileSync(join(benchDir(), "graph.k7x"), "utf8");
    expect(graph).not.toContain("reverb");
  });

  it("is refused for a bare rig, and for a library — which is edited from any project", async () => {
    await expect(ensureBench(EMAIL, BENCH_PROJECT)).rejects.toThrow(/chain/);
    await expect(ensureBench(EMAIL, benchProject("@k7-core"))).rejects.toThrow(
      /any project/,
    );
  });

  it("clears the per-chain benches an older address left behind", async () => {
    const stale = join(benchRoot(), "chains", "live", "vocals.k7");
    mkdirSync(stale, { recursive: true });
    writeFileSync(
      join(stale, "project.k7x"),
      'project({ name: "x" })\n',
      "utf8",
    );
    await openChainBench();
    expect(existsSync(join(benchRoot(), "chains"))).toBe(false);
    expect(existsSync(join(libraryChain(), "graph.k7x"))).toBe(true);
  });
});

describe("a write into a library", () => {
  const songs = (): Workspace => {
    mkdirSync(join(rootDir(), "songs"), { recursive: true });
    return new Workspace(join(rootDir(), "songs"));
  };

  it("lands in an admin's own clone, never the server's, from any workspace", () => {
    setLibraryOverlays([{ name: "k7-core", root: editClone() }]);
    const ws = songs();
    const rel = "_libraries/k7-core/modules/audio/limit/module.k7x";
    expect(ws.write(rel, 'plugin({ type: "internal" })\n')).toEqual({});
    expect(
      readFileSync(join(editClone(), "modules/audio/limit/module.k7x"), "utf8"),
    ).toContain("internal");
    expect(existsSync(join(libraryDir(), "modules/audio/limit"))).toBe(false);
    expect(existsSync(join(rootDir(), "songs", "_libraries"))).toBe(false);
  });

  it("is refused to an account that holds no clone of it — anyone but an admin", () => {
    const ws = songs();
    expect(() =>
      ws.write("_libraries/k7-core/modules/amp.k7x", "gain(2)\n"),
    ).toThrow(/admins/);
    expect(existsSync(join(libraryDir(), "modules/amp.k7x"))).toBe(false);
  });

  it("refuses a path that climbs out of the library through the virtual folder", () => {
    setLibraryOverlays([{ name: "k7-core", root: editClone() }]);
    expect(() =>
      songs().write("_libraries/k7-core/../../escape.k7x", "x(1)\n"),
    ).toThrow(/escapes/);
  });
});
