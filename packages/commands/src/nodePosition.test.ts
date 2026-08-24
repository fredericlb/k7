// `graph move` — the pin behind "modules stay where you moved them", through the
// dispatcher, asserting graph.yaml. A refusal must leave the file byte-identical, and
// `auto` must leave no trace of the round trip.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

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

const chains = () => readFileSync(join(dir, "graph.yaml"), "utf8");

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-modpos-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(d, "graph.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(d, "nodes"), { recursive: true });
  writeFileSync(
    join(d, "nodes", "gtr.yaml"),
    'extends: "@studio/track"\nevents: []\n',
    "utf8",
  );
  const md = join(d, "modules", "audio", "amp");
  mkdirSync(md, { recursive: true });
  writeFileSync(
    join(md, "module.yaml"),
    "plugin:\n  type: internal\n  name: Chorus\n",
    "utf8",
  );
  // A curve, so the CURVE node case has something to pin — it is not a chains node.
  mkdirSync(join(d, "curves"), { recursive: true });
  writeFileSync(
    join(d, "curves", "wob.yaml"),
    "type: lfo\nfrequency: 2\n",
    "utf8",
  );
  return d;
}

beforeEach(() => {
  dir = song();
  logs.length = 0;
  reloads = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("graph move", () => {
  it("pins the node, rounded — and ABOVE the origin, which is a place like any other", async () => {
    await runCommand("graph move amp 420.6 -15", host(), "cli");
    expect(chains()).toContain("amp: { x: 421, y: -15 }");
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
    expect(chains()).toContain("wob: { x: 60, y: 90 }");
  });

  it("a node CREATED with a trailing x,y is born there — pinned in the same undo step", async () => {
    // `node new` takes the click, so one command creates and pins (packages/song/docs/nodes.md).
    await runCommand("module new audio/verb2", host(), "cli");
    await runCommand("node new audio/verb2 verb2n 120,80", host(), "cli");
    expect(chains()).toContain("verb2n: []");
    expect(chains()).toContain("verb2n: { x: 120, y: 80 }");
  });

  it("without the token, it is born above the origin rather than left to the layout", async () => {
    // A node wired to nothing is what a fresh layout has least to say about, so the verb answers — docs/verbs.md.
    await runCommand("module new audio/verb3", host(), "cli");
    await runCommand("node new audio/verb3 verb3n", host(), "cli");
    expect(chains()).toContain("verb3n: []");
    expect(chains()).toContain("verb3n: { x: 0, y: -30 }");
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

  it("refuses a node the project does not know, writing nothing", async () => {
    const before = chains();
    await runCommand("graph move nothere 10 10", host(), "cli");
    expect(logs.join(" ")).toContain('no node "nothere"');
    expect(chains()).toBe(before);
    expect(reloads).toBe(0);
  });
});
