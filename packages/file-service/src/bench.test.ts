// The bench ON a library — an admin's, the one place that library is written — and what every
// other place may not do. What is proved: it opens, it keeps nothing of the rig, a library module
// written there lands in the bench's own clone and never in the server's, and a write into a
// library from anywhere else is refused.

import { execFileSync } from "node:child_process";
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
import { rootDir, sshDir } from "@studio/engine-client/paths";
import { setLibraryOverlay } from "@studio/song/sharedFolders";
import {
  BENCH_PROJECT,
  libraryBenchProject,
} from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureBench } from "./bench.ts";
import { closeLibraryBench } from "./libraryBench.ts";
import { slugify } from "./slug.ts";
import { Workspace } from "./workspace.ts";
import { listWorkspaces } from "./workspaces.ts";

const EMAIL = "someone@example.test";

/** The package-wide pin from vitest.config.ts, put back after each test rather than deleted. */
const PINNED_HOME = process.env.STUDIO_HOME;
let home: string;

const benchRoot = (): string => join(rootDir(), BENCH_WORKSPACE);
const benchDir = (): string => join(benchRoot(), BENCH_PROJECT);
/** The server's clone, read-only — under `$STUDIO_HOME/libraries` when no hub names another. */
const libraryDir = (): string => join(home, "libraries", "st0");
const libraryChain = (): string => join(libraryDir(), "chains/live/vocals");
/** The bench's own clone of `st0`, already there — so opening it runs no clone. */
const benchClone = (): string => join(home, "bench-libraries", "st0");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t.test",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t.test",
    },
  });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-bench-home-"));
  // Off the real machine: this test writes library checkouts, and the user's own are not fixtures.
  process.env.STUDIO_HOME = home;

  // The `st0` library, laid out by hand where the hub would have cloned it.
  mkdirSync(libraryChain(), { recursive: true });
  writeFileSync(
    join(libraryChain(), "graph.yaml"),
    '# Voix live.\nmodules:\n  "@in": [ comp ]\n  comp: [ "@out" ]\n',
    "utf8",
  );
  // …and the bench's clone of it, a checkout of its own with nothing unpublished.
  mkdirSync(join(benchClone(), "modules"), { recursive: true });
  writeFileSync(join(benchClone(), "modules", "amp.yaml"), "gain: 1\n");
  git(benchClone(), "init", "-q", "--initial-branch=main");
  git(benchClone(), "add", "-A");
  git(benchClone(), "commit", "-q", "-m", "first");
  // A key already "there", so `ensureKey` makes none: CI's image has no ssh-keygen.
  const keyDir = sshDir(slugify(EMAIL));
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(join(keyDir, "id_ed25519"), "placeholder\n");
});

afterEach(() => {
  setLibraryOverlay(null);
  process.env.STUDIO_HOME = PINNED_HOME;
  rmSync(home, { recursive: true, force: true });
});

const openLibraryBench = () => ensureBench(EMAIL, libraryBenchProject("st0"));

describe("the bench on a library", () => {
  it("opens on a live rig", async () => {
    const { workspace, project } = await openLibraryBench();
    expect(workspace).toBe(BENCH_WORKSPACE);
    expect(project).toBe(BENCH_PROJECT);
    const graph = readFileSync(join(benchDir(), "graph.yaml"), "utf8");
    expect(graph).toContain("IN: [ fader ]");
    expect(existsSync(join(benchDir(), "surfaces"))).toBe(false);
  });

  it("is not one of the workspaces the home page lists", async () => {
    mkdirSync(join(rootDir(), "songs"), { recursive: true });
    await openLibraryBench();
    expect(existsSync(benchRoot())).toBe(true);
    expect(listWorkspaces(EMAIL).map((w) => w.name)).toEqual(["songs"]);
  });

  it("throws away what was wired on it, at the next open", async () => {
    await openLibraryBench();
    const ws = new Workspace(benchRoot());
    ws.setActiveProject(BENCH_PROJECT);
    ws.write(
      `${BENCH_PROJECT}/graph.yaml`,
      "modules:\n  IN: [ reverb ]\n  reverb: [ MIX ]\n",
    );
    await openLibraryBench();
    const graph = readFileSync(join(benchDir(), "graph.yaml"), "utf8");
    expect(graph).not.toContain("reverb");
  });

  it("writes a library module into the BENCH's clone, never the server's", async () => {
    await openLibraryBench();
    const ws = new Workspace(benchRoot());
    ws.setActiveProject(BENCH_PROJECT);
    const rel = "_libraries/st0/modules/audio/comp/module.yaml";
    expect(ws.write(rel, "plugin:\n  type: internal\n")).toEqual({});
    expect(
      readFileSync(
        join(benchClone(), "modules/audio/comp/module.yaml"),
        "utf8",
      ),
    ).toContain("internal");
    expect(existsSync(join(libraryDir(), "modules/audio/comp"))).toBe(false);
    expect(existsSync(join(benchRoot(), "_libraries"))).toBe(false);
  });

  it("refuses a write into a library anywhere but on its bench", async () => {
    await openLibraryBench();
    closeLibraryBench();
    const ws = new Workspace(benchRoot());
    expect(() =>
      ws.write("_libraries/st0/modules/amp.yaml", "gain: 2\n"),
    ).toThrow(/bench/);
    expect(existsSync(join(libraryDir(), "modules/amp.yaml"))).toBe(false);
  });

  it("refuses a path that climbs out of the library through the virtual folder", async () => {
    await openLibraryBench();
    const ws = new Workspace(benchRoot());
    expect(() =>
      ws.write("_libraries/st0/../../escape.yaml", "x: 1\n"),
    ).toThrow(/escapes/);
  });

  it("is refused for an address naming neither a library nor a chain", async () => {
    await expect(ensureBench(EMAIL, BENCH_PROJECT)).rejects.toThrow(/library/);
  });

  it("clears the per-chain benches an older address left behind", async () => {
    const stale = join(benchRoot(), "chains", "live", "vocals.st0");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "project.yaml"), "project:\n  name: x\n", "utf8");
    await openLibraryBench();
    expect(existsSync(join(benchRoot(), "chains"))).toBe(false);
    expect(existsSync(join(libraryChain(), "graph.yaml"))).toBe(true);
  });
});
