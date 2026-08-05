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

// A chain step naming a module the project doesn't define used to be FATAL: the compiler's
// ref-check threw. (A generated CUE overlay pinned the field too, which is why this was
// fatal in two places at once; that overlay is gone.) One dangling name
// — a module folder renamed, a song opened without the workspace it borrows from — took
// the whole project down, timeline included.
//
// It is now a skipped step and a `?` node in the graph. These pin both halves: the file
// still compiles, and the dangling name is reported as a warning rather than swallowed.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.l8",
);

// Point the fixture's instrument step at a module that doesn't exist, keeping everything
// else — so what changes in the result is only ever this.
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
    const doc = compileNodeProject(dir); // used to throw: module 'ghost' not found
    const melody = doc.tracks.find((t) => t.id === "melody");
    expect(melody).toBeTruthy();
    expect(melody!.plugins.some((p) => p.id.endsWith(":ghost"))).toBe(false);
  });

  it("leaves the rest of the chain running", () => {
    // The point of not failing: a dangling step costs you that one node, not the song.
    // Here it sits BESIDE a real instrument, which must still compile into the track.
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
    // Still a step of its chain — that is what the graph draws the `?` node from, and
    // what `module bypass ghost` finds to write `enabled: false` on.
    expect(
      Object.values(g.chains).some((c) =>
        c.use.some((s) => s.module === "ghost"),
      ),
    ).toBe(true);
  });
});
