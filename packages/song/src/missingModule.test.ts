import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { insertChainStepAfter, replaceChainStep } from "./testSupport";

// A dangling step is not FATAL: it is a skipped step, a `?` node and a warning.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "demos",
  "synth-demo.st0",
);

// Point the instrument step at a module that does not exist, and change nothing else.
const useGhostStep = (dir: string): void =>
  replaceChainStep(dir, "lead", { module: "ghost" });

describe("a chain step naming a missing module", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-ghost-"));
    cpSync(SONG, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("compiles, contributing no plugin — like a bypassed step", () => {
    useGhostStep(dir);
    const doc = compileNodeProject(dir); // must not throw: module 'ghost' is a warning
    const melody = doc.tracks.find((t) => t.id === "melody");
    expect(melody).toBeTruthy();
    expect(melody!.plugins.some((p) => p.id.endsWith(":ghost"))).toBe(false);
  });

  it("leaves the rest of the chain running", () => {
    // A dangling step costs that one node: the real instrument beside it still compiles.
    insertChainStepAfter(dir, "lead", { module: "ghost" });

    const melody = compileNodeProject(dir).tracks.find(
      (t) => t.id === "melody",
    );
    expect(melody!.plugins.some((p) => p.id.endsWith(":ghost"))).toBe(false);
    expect(melody!.plugins.some((p) => p.type === "4osc")).toBe(true);
  });

  it("is reported as a graph warning, so it isn't silently dropped", () => {
    useGhostStep(dir);
    const g = loadGraph(dir);
    expect(g.warnings.some((w) => w.includes("ghost"))).toBe(true);
    // Still a step of its chain, which is what the graph draws the `?` node from.
    expect(
      Object.values(g.chains).some((c) =>
        c.use.some((s) => s.module === "ghost"),
      ),
    ).toBe(true);
  });
});
