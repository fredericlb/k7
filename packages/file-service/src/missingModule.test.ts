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
import { replaceChainStep, writeModule } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

// A chain step naming an undefined module is drawn as a `?` node, with every module affordance empty.

const here = dirname(fileURLToPath(import.meta.url)); // packages/file-service/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.st0",
);

let root: string;
let proj: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-ghost-"));
  proj = join(root, "song.st0");
  cpSync(SONG, proj, { recursive: true });
  // The demo's chains end at "OUT" and the song ships no `modules/io/OUT`, so give it the real sink.
  writeModule(proj, "io", "OUT", { io: "out" });
  // Point the instrument step at a module that isn't there.
  replaceChainStep(proj, "lead", { module: "ghost" });

  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const ghostStep = () =>
  Object.values(ws.graphDoc().chains)
    .flatMap((c) => c.use)
    .find((s) => s.module === "ghost");

describe("a graph with a missing module", () => {
  it("reads at all, and keeps the step in its chain", () => {
    // The project opens: this used to throw, and the UI showed "graph unavailable" for the whole song.
    expect(() => ws.graphDoc()).not.toThrow();
    expect(ghostStep()).toBeTruthy();
  });

  it("flags the step, so the graph can draw the name with a `?`", () => {
    expect(ghostStep()?.missing).toBe(true);
  });

  it("offers nothing to open, edit or set on it", () => {
    const s = ghostStep()!;
    // No plugin window, no widget grid, no engine id: each would point at a module that isn't there.
    expect(s.hasNativePluginUI).toBeFalsy();
    expect(s.ui).toBeUndefined();
    expect(s.pluginId).toBeUndefined();
    // Not a stub either: a stub is a module that EXISTS and carries no plugin.
    expect(s.stub).toBeFalsy();
  });

  it("says so in the graph's warnings", () => {
    expect(ws.graphDoc().warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  it("still flags a module that exists as not missing", () => {
    // The flag has to be about THIS step, not "the graph has a problem".
    const others = Object.values(ws.graphDoc().chains)
      .flatMap((c) => c.use)
      .filter((s) => s.module !== "ghost");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((s) => !s.missing)).toBe(true);
  });
});
