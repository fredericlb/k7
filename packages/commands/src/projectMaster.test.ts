// `project master` and `node param "OUT" Volume` — the song's output level under both of its
// names, and the three things about it that would be wrong silently: a value above the fader's top
// being ACCEPTED (Tracktion clamps it, so the file would disagree with the sound for ever), unity
// being written instead of removed, and the two spellings drifting apart.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { MASTER_MAX_DB } from "@studio/song-schema/yaml/projectSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
// What the ENGINE was told, which is the half a file read cannot see.
let applied: { masterVolume?: number }[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    applyProject: (p: { masterVolume?: number }) => void applied.push(p),
    reload: () => {},
  }) as never;

const projectText = () => wsText(join(dir, "project.k7x"));
const master = () =>
  (wsData(join(dir, "project.k7x")).project as { masterVolume?: number })
    .masterVolume;

beforeEach(() => {
  logs.length = 0;
  applied = [];
  dir = mkdtempSync(join(tmpdir(), "td-master-"));
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  mkdirSync(join(dir, "nodes"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("project master", () => {
  it("writes the level, and the compiled doc carries it to the engine", async () => {
    await runCommand("project master -4.5", host(), "cli");
    expect(master()).toBe(-4.5);
    // The half that matters: the engine reads the DOC, not the file.
    expect(loadProject(dir).masterVolume).toBe(-4.5);
  });

  it("REMOVES the line at unity rather than writing a zero", async () => {
    // The rule `type:` and `status:` already follow: nothing to say means nothing written.
    await runCommand("project master -4.5", host(), "cli");
    await runCommand("project master 0", host(), "cli");
    expect(projectText()).not.toContain("masterVolume");
    // …and unity is still what the doc reports, which is the point of the default.
    expect(loadProject(dir).masterVolume).toBe(0);
  });

  it("a doc that predates the field reads as unity", async () => {
    expect(loadProject(dir).masterVolume).toBe(0);
  });

  it("REFUSES above the fader's top instead of clamping to it", async () => {
    // Tracktion's curve gives every value over +6 one position: accepting 12 would set 6.
    await runCommand(`project master ${MASTER_MAX_DB + 6}`, host(), "cli");
    expect(projectText()).not.toContain("masterVolume");
    expect(logs.join(" ")).toContain("outside the fader");
    // …and says where the headroom actually is, which is not here.
    expect(logs.join(" ")).toContain("STRIPS");
  });

  it("refuses below the floor too, and anything that is not a number", async () => {
    await runCommand("project master -200", host(), "cli");
    expect(logs.join(" ")).toContain("outside the fader");

    // …and a word never reaches the handler: the catalogue shape-checks `type: number` first.
    logs.length = 0;
    await runCommand("project master loud", host(), "cli");
    expect(logs.join(" ")).toContain("expects a number");

    expect(projectText()).not.toContain("masterVolume");
  });

  it("takes the top of the fader itself — the bound is inclusive", async () => {
    await runCommand(`project master ${MASTER_MAX_DB}`, host(), "cli");
    expect(loadProject(dir).masterVolume).toBe(MASTER_MAX_DB);
  });

  // PATCHED, not reloaded: the header fader releases onto this and a rebuild would stop the song.
  it("patches the running engine with the new level rather than reloading", async () => {
    await runCommand("project master -4.5", host(), "cli");
    expect(applied.map((p) => p.masterVolume)).toEqual([-4.5]);
  });
});

// The output is a NODE and its level is that node's param — the same write, under another name.
describe('node param "OUT" Volume', () => {
  it("writes the same level `project master` does", async () => {
    await runCommand('node param "OUT" Volume -4.5', host(), "cli");
    expect(master()).toBe(-4.5);
    expect(loadProject(dir).masterVolume).toBe(-4.5);
    expect(applied.map((p) => p.masterVolume)).toEqual([-4.5]);
  });

  it("removes the line at unity, like the verb does", async () => {
    await runCommand('node param "OUT" Volume -4.5', host(), "cli");
    await runCommand('node param "OUT" Volume 0', host(), "cli");
    expect(projectText()).not.toContain("masterVolume");
  });

  it("refuses outside the fader rather than clamping", async () => {
    await runCommand(
      `node param "OUT" Volume ${MASTER_MAX_DB + 6}`,
      host(),
      "cli",
    );
    expect(logs.join(" ")).toContain("outside the fader");
    expect(projectText()).not.toContain("masterVolume");
  });

  // Answered BEFORE the plugin lookup, or the message would list every module in the song.
  it("refuses any other param on OUT by name", async () => {
    await runCommand('node param "OUT" Pan 0.5', host(), "cli");
    expect(logs.join(" ")).toContain("one param, Volume");
    expect(logs.join(" ")).not.toContain("no plugin module");
  });

  // The near miss somebody will type: MIX is the sum, and a level belongs to what LEAVES.
  it("sends MIX to OUT rather than refusing it blankly", async () => {
    await runCommand('node param "MIX" Volume -3', host(), "cli");
    expect(logs.join(" ")).toContain('node param "OUT" Volume -3');
    expect(projectText()).not.toContain("masterVolume");
  });
});
