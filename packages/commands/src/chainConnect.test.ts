// `graph chain connect` — the patch-cable verb, through the dispatcher, asserting graph.yaml.
// What matters: it CREATES an arrow (no existing one required, unlike `node insert`), it never
// unwires what the source already feeds, and every refusal leaves the file byte-identical.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeLane, writeNode } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
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

const graphFile = () => join(dir, "graph.k7x");
/** The file's text, for the refusals that must leave it byte-identical. */
const chains = () => readFileSync(graphFile(), "utf8");
const graph = () => wsData(graphFile());
/** What `name` feeds, as the file lists it. */
const feeds = (name: string) =>
  (graph().modules as Record<string, string[]>)[name];
const setGraph = (modules: Record<string, string[]>) =>
  writeDoc(graphFile(), { modules });

function song(): { root: string; dir: string } {
  const r = mkdtempSync(join(tmpdir(), "td-connect-"));
  const d = join(r, "song.k7");
  mkdirSync(d, { recursive: true });
  writeDoc(join(d, "project.k7x"), { project: { name: "t", tempo: 120 } });
  // `reverb` is placed and unwired — the free jacks the gesture exists for.
  writeDoc(join(d, "graph.k7x"), {
    modules: { gtr: ["amp"], amp: ["OUT"], reverb: [] },
  });
  writeLane(d, "gtr", "track", { events: [] });
  // Each is a workspace module, USED through a node of the same bare name — a module lives at
  // `@workspace` now, and a chain still names the node, not the module, directly.
  for (const m of ["amp", "reverb"]) {
    writeDoc(join(r, "_modules", "audio", m, "module.k7x"), {
      plugin: { type: "internal", name: "Chorus" },
    });
    writeNode(d, m, { extends: `@workspace/audio/${m}` });
  }
  // A PICTURE lane, which is a card on the graph and takes a cable from a lens (packages/song/docs/camera.md).
  writeDoc(join(d, "video_tracks", "main.k7x"), { events: [] });
  return { root: r, dir: d };
}

beforeEach(() => {
  ({ root, dir } = song());
  logs.length = 0;
  reloads = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("graph chain connect", () => {
  it("draws a new arrow without touching what the source already feeds", async () => {
    await runCommand("graph chain connect amp reverb", host(), "cli");
    expect(chains()).toContain("amp: [ OUT, reverb ]");
    expect(logs.join(" ")).toContain("connected amp → reverb");
    expect(reloads).toBe(1);
  });

  it("wires an unwired module to the sink — how a placed module joins the song", async () => {
    await runCommand("graph chain connect reverb OUT", host(), "cli");
    expect(chains()).toContain("reverb: [ OUT ]");
  });

  it("wires to MIX as readily as to OUT — all four built-in outputs are nodes", async () => {
    // The two verbs used to spell `name === "OUT"` by hand, so a set's `fadeA: [ MIX ]` was unwireable.
    await runCommand("graph chain connect reverb MIX", host(), "cli");
    expect(logs.join(" ")).not.toContain("no node");
    expect(chains()).toContain("reverb: [ MIX ]");
  });

  it("refuses an arrow that is already there, writing nothing", async () => {
    const before = chains();
    await runCommand("graph chain connect gtr amp", host(), "cli");
    expect(logs.join(" ")).toContain("already feeds");
    expect(chains()).toBe(before);
    expect(reloads).toBe(0);
  });

  it("refuses a node the project does not know", async () => {
    const before = chains();
    await runCommand("graph chain connect amp nothere", host(), "cli");
    expect(logs.join(" ")).toContain('no node "nothere"');
    expect(chains()).toBe(before);
  });

  it("refuses the sink as a source, and an ORDINARY module aimed at a lane", async () => {
    await runCommand("graph chain connect OUT reverb", host(), "cli");
    expect(logs.join(" ")).toContain("sink");
    await runCommand("graph chain connect reverb gtr", host(), "cli");
    // The derivation discards anything else aimed at a lane, so the cable would go nowhere.
    expect(logs.join(" ")).toContain(
      "only a live input's signal lands on a lane",
    );
    expect(reloads).toBe(0);
  });

  it("LETS a live input feed a lane — which is what recording onto one is", async () => {
    // The one exception the model makes; refusing every track left an `IN` node with nowhere to go.
    // io is a plain NODE now, never a shared module.
    writeFileSync(join(dir, "nodes", "mic.yaml"), "io: in\n", "utf8");
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n  mic: []\n",
      "utf8",
    );
    await runCommand("graph chain connect mic gtr", host(), "cli");
    expect(logs.join(" ")).toContain("connected mic → gtr");
    expect(chains()).toContain("mic: [ gtr ]");
  });

  it("LETS a MIDI device feed a lane too — its notes are what that lane records", async () => {
    writeFileSync(join(dir, "nodes", "keys.yaml"), "io: midi\n", "utf8");
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n  keys: []\n",
      "utf8",
    );
    await runCommand("graph chain connect keys gtr", host(), "cli");
    expect(logs.join(" ")).toContain("connected keys → gtr");
  });

  it("…and still when the input is UPSTREAM, not the node the cable leaves", async () => {
    // What decides is the run REACHING the source, not the source itself — `runCarriesInput`.
    writeFileSync(join(dir, "nodes", "mic.yaml"), "io: in\n", "utf8");
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n  mic: [ reverb ]\n  reverb: []\n",
      "utf8",
    );
    // The derivation splits this into TWO chains, so only walking the feeds finds the preamp.
    await runCommand("graph chain connect reverb gtr", host(), "cli");
    expect(logs.join(" ")).toContain("connected reverb → gtr");
  });

  it("refuses a node fed to itself, ports notwithstanding", async () => {
    await runCommand("graph chain connect amp#b amp", host(), "cli");
    expect(logs.join(" ")).toContain("itself");
  });
});

describe("node insert, born at the cursor", () => {
  it("a trailing x,y pins the spliced node where the + was clicked", async () => {
    await runCommand("node insert gtr amp reverb 300,140", host(), "cli");
    expect(chains()).toContain("gtr: [ reverb ]");
    expect(chains()).toContain("reverb: [ amp ]");
    expect(chains()).toContain("reverb: { x: 300, y: 140 }");
  });
});

describe("graph chain disconnect", () => {
  it("pulls one cable, and the module it stranded stays placed", async () => {
    await runCommand("graph chain disconnect amp OUT", host(), "cli");
    expect(chains()).toContain("amp: []");
    expect(chains()).toContain("gtr: [ amp ]");
    expect(reloads).toBe(1);
  });

  it("refuses an arrow that is not there, writing nothing", async () => {
    const before = chains();
    await runCommand("graph chain disconnect gtr reverb", host(), "cli");
    expect(logs.join(" ")).toContain("does not feed");
    expect(chains()).toBe(before);
    expect(reloads).toBe(0);
  });
});

describe("graph chain replug", () => {
  it("moves one end in one write — the old arrow gone, the new one there", async () => {
    // The target end of gtr→amp moves to reverb.
    await runCommand("graph chain replug gtr amp gtr reverb", host(), "cli");
    expect(chains()).toContain("gtr: [ reverb ]");
    expect(chains()).not.toContain("gtr: [ amp ]");
    expect(reloads).toBe(1);
  });

  it("says so when nothing moved, and writes nothing", async () => {
    const before = chains();
    await runCommand("graph chain replug gtr amp gtr amp", host(), "cli");
    expect(logs.join(" ")).toContain("nothing moved");
    expect(chains()).toBe(before);
  });

  it("a bad OLD arrow refuses the whole move — no half-replug", async () => {
    const before = chains();
    await runCommand("graph chain replug gtr reverb gtr OUT", host(), "cli");
    expect(logs.join(" ")).toContain("does not feed");
    expect(chains()).toBe(before);
  });

  it("the new pair passes the connect checks — an unknown node refuses it", async () => {
    const before = chains();
    await runCommand("graph chain replug gtr amp gtr nothere", host(), "cli");
    expect(logs.join(" ")).toContain('no node "nothere"');
    expect(chains()).toBe(before);
  });
});

// `namesANode` read modules/tracks only, so every cable to a picture lane was refused.
describe("a cable to a picture lane", () => {
  it("connects, a lane being a node like any other", async () => {
    await runCommand("graph chain connect amp main", host(), "cli");
    expect(chains()).toContain("amp: [ OUT, main ]");
    expect(reloads).toBe(1);
  });

  it("replugs onto one too", async () => {
    await runCommand("graph chain connect amp reverb", host(), "cli");
    logs.length = 0;
    await runCommand("graph chain replug amp reverb amp main", host(), "cli");
    expect(chains()).toContain("main");
    expect(logs.join(" ")).not.toMatch(/no node/);
  });

  it("names the picture lanes when the name is none of them", async () => {
    await runCommand("graph chain connect amp nope", host(), "cli");
    expect(logs.join(" ")).toContain("picture lanes: main");
    expect(reloads).toBe(0);
  });
});
