// `node new` — a use of an existing module, AND its place in the graph.
//
// The second half is the point. A node file with no entry in `graph.k7x` is loaded by the
// project and drawn nowhere: the graph's blocks come off the chains, so a node created without
// one exists on disk and is on no screen. Every node is in the graph; `modules({ x: [] })` says so.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeLane } from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

const AMP = "@workspace/audio/amp";
const graph = () =>
  wsData(join(dir, "graph.k7x")) as {
    modules: Record<string, string[]>;
    positions?: Record<string, { x: number; y: number }>;
  };
const extendsOf = (name: string) =>
  wsData(join(dir, "nodes", `${name}.k7x`)).extends;
const workspaceModule = (name: string, value: Record<string, unknown>) =>
  writeDoc(join(root, "_modules", "audio", name, "module.k7x"), value);
const CHORUS = { plugin: { type: "internal", name: "Chorus" } };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-new-"));
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeDoc(join(dir, "graph.k7x"), { modules: { gtr: [AMP], [AMP]: ["OUT"] } });
  writeLane(dir, "gtr", "track", { events: [] });
  // A module lives at `@workspace` now — beside the project, in the workspace's own `_modules`.
  workspaceModule("amp", CHORUS);
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("node new", () => {
  it("writes the node file AND names it in the chains", async () => {
    await runCommand("node new audio/amp hall", host(), "cli");
    expect(existsSync(join(dir, "nodes", "hall.k7x"))).toBe(true);
    // The half that matters: without it the file is loaded and drawn nowhere.
    expect(graph().modules).toHaveProperty("hall");
  });

  it("puts it in wired to NOTHING, disturbing no existing run", async () => {
    await runCommand("node new audio/amp hall", host(), "cli");
    // gtr -> amp -> OUT is exactly as it was.
    expect(graph().modules).toEqual({ gtr: [AMP], [AMP]: ["OUT"], hall: [] });
  });

  it("takes the click's x,y, so a node born on the canvas lands under the cursor", async () => {
    await runCommand("node new audio/amp hall 120,80", host(), "cli");
    // `positions: { <node>: { x, y } }` — see song-schema/yaml/graphFile.ts.
    expect(graph().positions?.hall).toEqual({ x: 120, y: 80 });
  });

  it("still refuses a target that is not <category>/<name>", async () => {
    await runCommand("node new amp hall", host(), "cli");
    expect(logs.join("\n")).toContain("is not <category>/<name>");
    expect(existsSync(join(dir, "nodes", "hall.k7x"))).toBe(false);
  });

  it("names the node in the chains under its OWN name, not the module's", async () => {
    // A chain step names the NODE file, so a `hall` appearing as `amp` would point at the module.
    await runCommand("node new audio/amp hall", host(), "cli");
    expect(Object.keys(graph().modules)).toContain("hall");
    expect(wsText(join(dir, "graph.k7x"))).toMatch(/\bhall: \[\]/);
  });

  it("links a CATALOGUE pick straight to its ref, scaffolding no workspace module", async () => {
    // A workspace module to point at, so the ref is one this project can answer — the engine's catalogue is ambient.
    workspaceModule("fuzz", CHORUS);
    await runCommand(
      "node new audio/echo e1 @workspace/audio/fuzz",
      host(),
      "cli",
    );
    expect(existsSync(join(root, "_modules", "audio", "echo"))).toBe(false);
    expect(extendsOf("e1")).toBe("@workspace/audio/fuzz");
    expect(graph().modules).toHaveProperty("e1");
  });

  it("takes the ref with the name left out, in either order", async () => {
    workspaceModule("fuzz", CHORUS);
    await runCommand(
      "node new audio/echo @workspace/audio/fuzz",
      host(),
      "cli",
    );
    expect(extendsOf("echo_1")).toBe("@workspace/audio/fuzz");
    await runCommand(
      "node new audio/wah @workspace/audio/fuzz wah1",
      host(),
      "cli",
    );
    expect(extendsOf("wah1")).toBe("@workspace/audio/fuzz");
    await runCommand(
      "node new audio/verb verb1 @workspace/audio/fuzz",
      host(),
      "cli",
    );
    expect(extendsOf("verb1")).toBe("@workspace/audio/fuzz");
  });

  it("refuses a ref that resolves to nothing, writing no node and no module", async () => {
    await runCommand(
      "node new audio/echo e1 @workspace/audio/nope",
      host(),
      "cli",
    );
    expect(logs.join("\n")).toContain("not a module this project can see");
    expect(existsSync(join(dir, "nodes", "e1.k7x"))).toBe(false);
    expect(existsSync(join(root, "_modules", "audio", "echo"))).toBe(false);
  });

  it("reads a module's OWN ref as 'use it', whatever it extends — the picker sends one", async () => {
    workspaceModule("echo", { extends: AMP });
    const echo = join(root, "_modules", "audio", "echo", "module.k7x");
    const before = wsText(echo);
    await runCommand(
      "node new audio/echo e1 @workspace/audio/echo",
      host(),
      "cli",
    );
    expect(logs.join("\n")).not.toContain("not '@workspace/audio/echo'");
    expect(extendsOf("e1")).toBe("@workspace/audio/echo");
    // …and the module is left extending what it did.
    expect(wsText(echo)).toBe(before);
  });

  it("takes a WHOLE ref as its target, extending it as it stands — the rack builder's kit", async () => {
    await runCommand("node new @workspace/audio/amp kit 40,20", host(), "cli");
    expect(extendsOf("kit")).toBe(AMP);
    expect(graph().modules.kit).toEqual([]);
    // No module is scaffolded in between: the ref already names one.
    expect(existsSync(join(root, "_modules", "audio", "kit"))).toBe(false);
  });

  it("refuses a whole ref that resolves to nothing, writing no node", async () => {
    await runCommand(
      "node new @k7-core/instruments/k7-rack kit",
      host(),
      "cli",
    );
    expect(logs.join("\n")).toContain("not a module this project can see");
    expect(existsSync(join(dir, "nodes", "kit.k7x"))).toBe(false);
  });
});
