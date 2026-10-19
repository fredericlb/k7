// `graph move` — the pin behind "modules stay where you moved them", through the
// dispatcher, asserting graph.k7x. A refusal must leave the file byte-identical, and
// `auto` must leave no trace of the round trip.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeLane, writeNode } from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
let reloads = 0;
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloads++;
    },
  }) as never;

const chains = () => wsText(join(dir, "graph.k7x"));
const graph = () =>
  wsData(join(dir, "graph.k7x")) as {
    modules: Record<string, string[]>;
    positions?: Record<string, { x: number; y: number }>;
  };
const pin = (name: string) => graph().positions?.[name];

function song(): { root: string; dir: string } {
  const r = mkdtempSync(join(tmpdir(), "td-modpos-"));
  const d = join(r, "song.k7");
  writeDoc(join(d, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeDoc(join(d, "graph.k7x"), { modules: { gtr: ["amp"], amp: ["OUT"] } });
  writeLane(d, "gtr", "track", { events: [] });
  // A module lives at `@workspace` now, used through a node of the same bare name.
  writeDoc(join(r, "_modules", "audio", "amp", "module.k7x"), {
    plugin: { type: "internal", name: "Chorus" },
  });
  writeNode(d, "amp", { extends: "@workspace/audio/amp" });
  // A curve, so the CURVE node case has something to pin — it is not a chains node.
  writeDoc(join(d, "curves", "wob.k7x"), { type: "lfo", frequency: 2 });
  // …and a PICTURE lane, which is a card on the graph and is no key of `modules:` either.
  writeDoc(join(d, "video_tracks", "main.k7x"), { events: [] });
  return { root: r, dir: d };
}

beforeEach(() => {
  ({ root, dir } = song());
  logs.length = 0;
  reloads = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("graph move", () => {
  it("pins the node, rounded — and ABOVE the origin, which is a place like any other", async () => {
    await runCommand("graph move amp 420.6 -15", host(), "cli");
    expect(pin("amp")).toEqual({ x: 421, y: -15 });
    expect(reloads).toBe(1);
  });

  it("`auto` hands it back and leaves no trace of the round trip", async () => {
    const before = chains();
    await runCommand("graph move amp 100 100", host(), "cli");
    await runCommand("graph move amp auto", host(), "cli");
    expect(chains()).toBe(before);
    expect(logs.join(" ")).toContain("back to the layout");
  });

  it("pins a CURVE by its id — a curve node is not a chains node, and moves all the same", async () => {
    await runCommand("graph move wob 60 90", host(), "cli");
    expect(pin("wob")).toEqual({ x: 60, y: 90 });
  });

  it("a node CREATED with a trailing x,y is born there — pinned in the same undo step", async () => {
    // `node new` takes the click, so one command creates and pins (packages/song/docs/nodes.md).
    await runCommand("module new audio/verb2", host(), "cli");
    await runCommand("node new audio/verb2 verb2n 120,80", host(), "cli");
    expect(graph().modules.verb2n).toEqual([]);
    expect(pin("verb2n")).toEqual({ x: 120, y: 80 });
  });

  it("without the token, it is born above the origin rather than left to the layout", async () => {
    // A node wired to nothing is what a fresh layout has least to say about, so the verb answers — docs/verbs.md.
    await runCommand("module new audio/verb3", host(), "cli");
    await runCommand("node new audio/verb3 verb3n", host(), "cli");
    expect(graph().modules.verb3n).toEqual([]);
    expect(pin("verb3n")).toEqual({ x: 0, y: -30 });
  });

  it("`graph organize` clears every pin in one step", async () => {
    await runCommand("graph move amp 10 20", host(), "cli");
    await runCommand("graph move wob 30 40", host(), "cli");
    reloads = 0;
    await runCommand("graph organize", host(), "cli");
    expect(chains()).not.toContain("positions");
    expect(logs.join(" ")).toContain("reorganized");
    expect(reloads).toBe(1);
  });

  // `videoTracks` is its own key, and reading only modules/tracks refused the node just dragged.
  it("pins a PICTURE lane, which the graph draws as a card like any other", async () => {
    await runCommand("graph move main 120 60", host(), "cli");
    expect(pin("main")).toEqual({ x: 120, y: 60 });
    expect(reloads).toBe(1);
  });

  it("names the picture lanes when a name is none of them", async () => {
    await runCommand("graph move nothere 10 10", host(), "cli");
    expect(logs.join(" ")).toContain("picture lanes: main");
  });

  it("refuses a node the project does not know, writing nothing", async () => {
    const before = chains();
    await runCommand("graph move nothere 10 10", host(), "cli");
    expect(logs.join(" ")).toContain('no node "nothere"');
    expect(chains()).toBe(before);
    expect(reloads).toBe(0);
  });

  it("pins the BUILT-IN outputs too, which have no folder to be found in", async () => {
    // Everything on the graph is a node; OUT and MIX are drawn, dragged and pinned like the rest.
    for (const sink of ["OUT", "MIX", "RENDER", "VIDEO_OUT"]) {
      logs.length = 0;
      await runCommand(`graph move ${sink} 10 20`, host(), "cli");
      expect(logs.join(" "), sink).not.toContain("no node");
      expect(pin(sink), sink).toEqual({ x: 10, y: 20 });
    }
  });

  it("hands a built-in output back to the layout like any other", async () => {
    await runCommand("graph move MIX 10 20", host(), "cli");
    await runCommand("graph move MIX auto", host(), "cli");
    expect(pin("MIX")).toBeUndefined();
  });
});
