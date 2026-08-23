// `project master` and `node param "OUT" Volume` — the song's output level under both of its
// names, and the three things about it that would be wrong silently: a value above the fader's top
// being ACCEPTED (Tracktion clamps it, so the file would disagree with the sound for ever), unity
// being written instead of removed, and the two spellings drifting apart.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { MASTER_MAX_DB } from "@studio/song/yaml/projectSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
// What the ENGINE was told, which is the half a file read cannot see: the level is patched in
// place rather than reloaded, so that a fader release does not stop the song.
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

const projectYaml = () => readFileSync(join(dir, "project.yaml"), "utf8");

beforeEach(() => {
  logs.length = 0;
  applied = [];
  dir = mkdtempSync(join(tmpdir(), "td-master-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("project master", () => {
  it("writes the level, and the compiled doc carries it to the engine", async () => {
    await runCommand("project master -4.5", host(), "cli");
    expect(projectYaml()).toContain("masterVolume: -4.5");
    // The half that matters: the engine reads the DOC, not the file.
    expect(loadProject(dir).masterVolume).toBe(-4.5);
  });

  it("REMOVES the line at unity rather than writing a zero", async () => {
    // The rule `type:` and a module's `status:` already follow — a file with nothing to say about
    // its output level stays a file that says nothing.
    await runCommand("project master -4.5", host(), "cli");
    await runCommand("project master 0", host(), "cli");
    expect(projectYaml()).not.toContain("masterVolume");
    // …and unity is still what the doc reports, which is the point of the default.
    expect(loadProject(dir).masterVolume).toBe(0);
  });

  it("a doc that predates the field reads as unity", async () => {
    expect(loadProject(dir).masterVolume).toBe(0);
  });

  it("REFUSES above the fader's top instead of clamping to it", async () => {
    // Tracktion's curve gives every value over +6 the same position. Accepting 12 would set 6 and
    // report 12, and the file would disagree with the sound for ever.
    await runCommand(`project master ${MASTER_MAX_DB + 6}`, host(), "cli");
    expect(projectYaml()).not.toContain("masterVolume");
    expect(logs.join(" ")).toContain("outside the fader");
    // …and says where the headroom actually is, which is not here.
    expect(logs.join(" ")).toContain("STRIPS");
  });

  it("refuses below the floor too, and anything that is not a number", async () => {
    await runCommand("project master -200", host(), "cli");
    expect(logs.join(" ")).toContain("outside the fader");

    // …and a word never reaches the handler at all: the catalogue shape-checks `type: number`
    // first and says so better than a usage line would, naming the argument and what arrived.
    logs.length = 0;
    await runCommand("project master loud", host(), "cli");
    expect(logs.join(" ")).toContain("expects a number");

    expect(projectYaml()).not.toContain("masterVolume");
  });

  it("takes the top of the fader itself — the bound is inclusive", async () => {
    await runCommand(`project master ${MASTER_MAX_DB}`, host(), "cli");
    expect(loadProject(dir).masterVolume).toBe(MASTER_MAX_DB);
  });

  // PATCHED, not reloaded. The header fader releases onto this and a rebuild would stop the song,
  // which is the whole reason `MasterVolumeChanged` is a live change in the engine's diff.
  it("patches the running engine with the new level rather than reloading", async () => {
    await runCommand("project master -4.5", host(), "cli");
    expect(applied.map((p) => p.masterVolume)).toEqual([-4.5]);
  });
});

// The output is a NODE, and its level is that node's param. Everything above is the same write
// under the name a person types.
describe('node param "OUT" Volume', () => {
  it("writes the same level `project master` does", async () => {
    await runCommand('node param "OUT" Volume -4.5', host(), "cli");
    expect(projectYaml()).toContain("masterVolume: -4.5");
    expect(loadProject(dir).masterVolume).toBe(-4.5);
    expect(applied.map((p) => p.masterVolume)).toEqual([-4.5]);
  });

  it("removes the line at unity, like the verb does", async () => {
    await runCommand('node param "OUT" Volume -4.5', host(), "cli");
    await runCommand('node param "OUT" Volume 0', host(), "cli");
    expect(projectYaml()).not.toContain("masterVolume");
  });

  it("refuses outside the fader rather than clamping", async () => {
    await runCommand(
      `node param "OUT" Volume ${MASTER_MAX_DB + 6}`,
      host(),
      "cli",
    );
    expect(logs.join(" ")).toContain("outside the fader");
    expect(projectYaml()).not.toContain("masterVolume");
  });

  // Answered BEFORE the plugin lookup, or the message would be "no plugin module 'OUT'" followed
  // by every module in the song — a list that points nowhere near the truth.
  it("refuses any other param on OUT by name", async () => {
    await runCommand('node param "OUT" Pan 0.5', host(), "cli");
    expect(logs.join(" ")).toContain("one param, Volume");
    expect(logs.join(" ")).not.toContain("no plugin module");
  });

  // The near miss somebody will type: MIX is the sum, and a level belongs to what LEAVES.
  it("sends MIX to OUT rather than refusing it blankly", async () => {
    await runCommand('node param "MIX" Volume -3', host(), "cli");
    expect(logs.join(" ")).toContain('node param "OUT" Volume -3');
    expect(projectYaml()).not.toContain("masterVolume");
  });
});
