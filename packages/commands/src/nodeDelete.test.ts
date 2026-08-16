// The two verbs that take a node out of a run, and what tells them apart.
//
// `graph unlink` rejoins what fed it to what it fed and LEAVES IT IN THE GRAPH, wired to
// nothing — everything is still on disk and still on screen. `node delete` does the same splice
// and then removes the node: its file, its preset, its entry, its pin.
//
// The failure worth guarding against is the same one either way, and it is quiet: a chains.yaml
// naming a node with no file is what stops the project loading.

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
    reload: () => {},
  }) as never;

const chains = () => readFileSync(join(dir, "chains.yaml"), "utf8");
const lane = (name: string) =>
  writeFileSync(
    join(dir, "nodes", `${name}.yaml`),
    'extends: "@studio/audio-track"\nevents: []\n',
    "utf8",
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-del-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  // gtr -> amp -> OUT, with amp pinned and bypassed so both are visible after the two verbs.
  writeFileSync(
    join(dir, "chains.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\nbypassed: [ amp ]\npositions:\n  amp: { x: 40, y: 60 }\n",
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
  lane("gtr");
  mkdirSync(join(dir, "modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(dir, "modules", "audio", "amp", "module.yaml"),
    "plugin:\n  type: internal\n  name: Chorus\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "nodes", "amp.yaml"),
    'extends: "audio/amp"\n',
    "utf8",
  );
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("graph unlink", () => {
  it("leaves the node IN the graph, wired to nothing", async () => {
    await runCommand("graph unlink amp", host(), "cli");
    const after = chains();
    // The entry survives — a node with none is drawn nowhere, which reads as a delete.
    expect(after).toMatch(/amp:\s*\[\s*\]/);
    // …and what fed it now feeds what it fed.
    expect(after).toMatch(/gtr:\s*\[\s*OUT\s*\]/);
  });

  it("keeps its pin, so an unlinked node does not jump across the canvas", async () => {
    await runCommand("graph unlink amp", host(), "cli");
    expect(chains()).toMatch(/amp:\s*\{[^}]*x:\s*40/);
  });

  it("keeps its bypass — it is still a node, and still silenced", async () => {
    await runCommand("graph unlink amp", host(), "cli");
    expect(chains()).toMatch(/bypassed:[\s\S]*amp/);
  });

  it("touches no file", async () => {
    await runCommand("graph unlink amp", host(), "cli");
    expect(existsSync(join(dir, "nodes", "amp.yaml"))).toBe(true);
  });
});

describe("node delete", () => {
  it("removes the file AND the entry, and rejoins the run", async () => {
    await runCommand("node delete amp", host(), "cli");
    expect(existsSync(join(dir, "nodes", "amp.yaml"))).toBe(false);
    const after = chains();
    expect(after).not.toMatch(/^\s+amp:/m);
    expect(after).toMatch(/gtr:\s*\[\s*OUT\s*\]/);
  });

  it("takes its pin and its bypass with it", async () => {
    await runCommand("node delete amp", host(), "cli");
    const after = chains();
    // A pin or a bypass naming a node that is gone is a key nothing can read.
    expect(after).not.toMatch(/positions:[\s\S]*amp/);
    expect(after).not.toMatch(/bypassed:[\s\S]*amp/);
  });

  it("leaves the MODULE alone — a node is one use of one", async () => {
    await runCommand("node delete amp", host(), "cli");
    expect(
      existsSync(join(dir, "modules", "audio", "amp", "module.yaml")),
    ).toBe(true);
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
