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

// A chain step naming a module the project doesn't define is drawn, not fatal: the graph
// carries the NAME with a `missing` flag, and the renderer turns that into a `?` node
// whose only control is bypass. Everything a real module node offers — the native plugin
// window, the widget grid, live params — needs a module that exists, so the flag has to
// arrive with all of those already empty.

const here = dirname(fileURLToPath(import.meta.url)); // packages/file-service/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo",
);

let root: string;
let proj: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-ghost-"));
  proj = join(root, "song");
  cpSync(SONG, proj, { recursive: true });
  // The demo's chains end at "OUT" but the song ships no modules/io/OUT, so give it the
  // real sink — otherwise every chain here is missing its sink as well as its instrument,
  // and the test couldn't tell the two apart.
  writeModule(proj, "io", "OUT", { io: "out" });
  // Point the instrument step at a module that isn't there.
  replaceChainStep(proj, "synth", { module: "ghost" });

  ws = new Workspace(root);
  ws.setActiveProject("song");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const ghostStep = () =>
  Object.values(ws.graphDoc().chains)
    .flatMap((c) => c.use)
    .find((s) => s.module === "ghost");

describe("a graph with a missing module", () => {
  it("reads at all, and keeps the step in its chain", () => {
    // The whole point: the project opens. This used to throw, and the UI showed
    // "graph unavailable" for the entire song.
    expect(() => ws.graphDoc()).not.toThrow();
    expect(ghostStep()).toBeTruthy();
  });

  it("flags the step, so the graph can draw the name with a `?`", () => {
    expect(ghostStep()?.missing).toBe(true);
  });

  it("offers nothing to open, edit or set on it", () => {
    const s = ghostStep()!;
    // No plugin window, no widget grid, no engine id to send a param to. Each of these
    // would otherwise point at a module that isn't there.
    expect(s.hasNativePluginUI).toBeFalsy();
    expect(s.ui).toBeUndefined();
    expect(s.pluginId).toBeUndefined();
    // Not a stub either: a stub is a module that EXISTS and carries no plugin. Telling
    // them apart is what lets the node say which of the two went wrong.
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
