// The two verbs that take a node out of a run, and what tells them apart.
//
// `graph unlink` rejoins what fed it to what it fed and LEAVES IT IN THE GRAPH, wired to
// nothing — everything is still on disk and still on screen. `node delete` does the same splice
// and then removes the node: its file, its preset, its entry, its pin.
//
// The failure worth guarding against is the same one either way, and it is quiet: a graph.k7x
// naming a node with no file is what stops the project loading.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeDoc,
  writeLane,
  writeModule,
  writeNode,
} from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

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

const chains = () => wsText(join(dir, "graph.k7x"));
const graph = () =>
  wsData(join(dir, "graph.k7x")) as {
    modules: Record<string, string[]>;
    bypassed?: string[];
    positions?: Record<string, { x: number; y: number }>;
  };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-del-"));
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  // gtr -> amp -> OUT, with amp pinned and bypassed so both are visible after the two verbs.
  writeDoc(join(dir, "graph.k7x"), {
    modules: { gtr: ["amp"], amp: ["OUT"] },
    bypassed: ["amp"],
    positions: { amp: { x: 40, y: 60 } },
  });
  writeLane(dir, "gtr", "track", { events: [] });
  writeModule(dir, "audio", "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  writeNode(dir, "amp", { extends: "audio/amp" });
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("graph unlink", () => {
  it("leaves the node IN the graph, wired to nothing", async () => {
    await runCommand("graph unlink amp", host(), "cli");
    const after = graph();
    // The entry survives — a node with none is drawn nowhere, which reads as a delete.
    expect(after.modules.amp).toEqual([]);
    // …and what fed it now feeds what it fed.
    expect(after.modules.gtr).toEqual(["OUT"]);
  });

  it("keeps its pin, so an unlinked node does not jump across the canvas", async () => {
    await runCommand("graph unlink amp", host(), "cli");
    expect(graph().positions?.amp).toEqual({ x: 40, y: 60 });
  });

  it("keeps its bypass — it is still a node, and still silenced", async () => {
    await runCommand("graph unlink amp", host(), "cli");
    expect(graph().bypassed).toContain("amp");
  });

  it("touches no file", async () => {
    await runCommand("graph unlink amp", host(), "cli");
    expect(existsSync(join(dir, "nodes", "amp.k7x"))).toBe(true);
  });
});

describe("node delete", () => {
  it("removes the file AND the entry, and rejoins the run", async () => {
    await runCommand("node delete amp", host(), "cli");
    expect(existsSync(join(dir, "nodes", "amp.k7x"))).toBe(false);
    const after = graph();
    expect(after.modules).not.toHaveProperty("amp");
    expect(after.modules.gtr).toEqual(["OUT"]);
  });

  it("takes its pin and its bypass with it", async () => {
    await runCommand("node delete amp", host(), "cli");
    const after = graph();
    // A pin or a bypass naming a node that is gone is a key nothing can read.
    expect(after.positions ?? {}).not.toHaveProperty("amp");
    expect(after.bypassed ?? []).not.toContain("amp");
  });

  it("leaves the MODULE alone — a node is one use of one", async () => {
    await runCommand("node delete amp", host(), "cli");
    expect(existsSync(join(dir, "modules", "audio", "amp", "module.k7x"))).toBe(
      true,
    );
  });

  it("deletes the node's own preset when it has one", async () => {
    writeFileSync(join(dir, "nodes", "amp.vstpreset"), "x", "utf8");
    await runCommand("node delete amp", host(), "cli");
    expect(existsSync(join(dir, "nodes", "amp.vstpreset"))).toBe(false);
  });

  it("refuses a name nothing answers to, and changes nothing", async () => {
    const before = chains();
    await runCommand("node delete nope", host(), "cli");
    expect(logs.join(" ")).toMatch(/no node 'nope'/);
    expect(chains()).toBe(before);
  });
});
