// The bench, opened with nothing named: no chain, no repository, no project of the account's. What
// is proved here is that it opens AT ALL and that it keeps nothing — a graph wired on the bench
// must not reach the library, which is the one shared thing this workspace can touch.

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
import { BENCH_PROJECT } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureBench } from "./bench.ts";
import { Workspace } from "./workspace.ts";

const EMAIL = "someone@example.test";

/** Never fetched: the mount is pre-populated, so `ensureLibraries` returns without touching git. */
const LIBRARIES_URI = "git@example.test:studio/libraries.git";

let home: string;

/** The bench's workspace, which is where the library submodule is mounted. */
const benchRoot = (): string => join(rootDir(), BENCH_WORKSPACE);
const benchDir = (): string => join(benchRoot(), BENCH_PROJECT);
const libraryChain = (): string =>
  join(benchRoot(), "_libraries", "chains/live/vocals");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-bench-home-"));
  // Off the real machine: this test writes a library checkout, and the user's own is not a fixture.
  process.env.STUDIO_HOME = home;

  // The library submodule, laid out by hand where the file service would have cloned it.
  mkdirSync(libraryChain(), { recursive: true });
  writeFileSync(
    join(libraryChain(), "graph.yaml"),
    '# Voix live.\nmodules:\n  "@in": [ comp ]\n  comp: [ "@out" ]\n',
    "utf8",
  );
});

afterEach(() => {
  delete process.env.STUDIO_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("the bench", () => {
  it("opens on a live rig, naming no chain of the library", async () => {
    const { workspace, project } = await ensureBench(EMAIL, LIBRARIES_URI);
    expect(workspace).toBe(BENCH_WORKSPACE);
    expect(project).toBe(BENCH_PROJECT);

    const graph = readFileSync(join(benchDir(), "graph.yaml"), "utf8");
    expect(graph).toContain("IN: [ fader ]");
    // No arrangement and no surface: what it opens on is the graph, and there is nothing else.
    expect(existsSync(join(benchDir(), "surfaces"))).toBe(false);
  });

  it("throws away what was wired on it, at the next open", async () => {
    await ensureBench(EMAIL, LIBRARIES_URI);
    const ws = new Workspace(benchRoot());
    ws.setActiveProject(BENCH_PROJECT);
    ws.write(
      `${BENCH_PROJECT}/graph.yaml`,
      "modules:\n  IN: [ reverb ]\n  reverb: [ MIX ]\n",
    );

    await ensureBench(EMAIL, LIBRARIES_URI);
    const graph = readFileSync(join(benchDir(), "graph.yaml"), "utf8");
    expect(graph).not.toContain("reverb");
    expect(graph).toContain("IN: [ fader ]");
  });

  it("sends nothing back to the library, graph or node", async () => {
    await ensureBench(EMAIL, LIBRARIES_URI);
    const ws = new Workspace(benchRoot());
    ws.setActiveProject(BENCH_PROJECT);

    const before = readFileSync(join(libraryChain(), "graph.yaml"), "utf8");
    ws.write(
      `${BENCH_PROJECT}/graph.yaml`,
      "modules:\n  IN: [ comp ]\n  comp: [ MIX ]\n",
    );
    ws.write(
      `${BENCH_PROJECT}/nodes/comp.yaml`,
      'extends: "@st0/audio/comp"\n',
    );

    expect(readFileSync(join(libraryChain(), "graph.yaml"), "utf8")).toBe(
      before,
    );
    expect(existsSync(join(libraryChain(), "nodes", "comp.yaml"))).toBe(false);
  });

  it("writes a shared module in place, with no fork and no push", async () => {
    // The one thing a bench session keeps: a library module is an ORDINARY path here.
    await ensureBench(EMAIL, LIBRARIES_URI);
    const ws = new Workspace(benchRoot());
    ws.setActiveProject(BENCH_PROJECT);

    const rel = "_libraries/modules/audio/comp/module.yaml";
    expect(ws.write(rel, "plugin:\n  type: internal\n")).toEqual({});
    expect(readFileSync(join(benchRoot(), rel), "utf8")).toContain("internal");
  });

  it("clears the per-chain benches an older address left behind", async () => {
    const stale = join(benchRoot(), "chains", "live", "vocals.st0");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "project.yaml"), "project:\n  name: x\n", "utf8");

    await ensureBench(EMAIL, LIBRARIES_URI);
    expect(existsSync(join(benchRoot(), "chains"))).toBe(false);
    // …and the library it was a view of is untouched by the sweep.
    expect(existsSync(join(libraryChain(), "graph.yaml"))).toBe(true);
  });
});
