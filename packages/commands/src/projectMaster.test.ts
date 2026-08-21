// `project master` — the song's output level, and the two things about it that would be wrong
// silently: a value above the fader's top being ACCEPTED (Tracktion clamps it, so the file would
// disagree with the sound for ever), and unity being written instead of removed.

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
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

const projectYaml = () => readFileSync(join(dir, "project.yaml"), "utf8");

beforeEach(() => {
  logs.length = 0;
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
});
