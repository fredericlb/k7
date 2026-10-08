// The takes verbs through the dispatcher, on a chain project: a MIDI pass filed as a take and comped
// in, a span given back to the event's own material, a take dropped — and what the compile plays.

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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
const event = () => parse(read("tracks/keys.yaml")).events[0];
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => loadProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "event-takes-"));
  dir = join(root, "song.st0");
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
  put(
    "tracks/keys.yaml",
    'extends: "@meta/track"\nevents:\n  - { ref: riff, start: "2:1" }\n',
  );
  put(
    "sequences/riff.yaml",
    'from: "1:1"\nto: "3:1"\nnotes:\n  - { t: 0, d: 1, k: 60 }\n',
  );
  put(
    "chains/keys.yaml",
    "start: true\nsteps:\n  - { id: lane-keys, track: keys }\n  - to: [ { chain: MIX } ]\n",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("event take midi", () => {
  it("files the pass as its own sequence and comps it in where it was played", async () => {
    // Bar 2 is beat 4: a pass from beat 6 to 10, punched into 6..8.
    const pass = {
      start: 6,
      end: 10,
      notes: [{ t: 6.5, d: 0.5, k: 64 }],
      punch: { from: 6, to: 8 },
    };
    const h = await run(`event take midi keys 2:1 ${JSON.stringify(pass)}`);
    expect(h.lines.refuse).toEqual([]);
    const ev = event();
    expect(ev.takes).toHaveLength(1);
    const take = ev.takes[0].ref;
    expect(ev.comp).toEqual([{ take, from: "2:3", to: "3:1" }]);
    const seq = parse(read(`sequences/${take}.yaml`));
    expect(seq.notes).toEqual([{ t: 0.5, d: 0.5, k: 64 }]);

    // The compile plays the event's own riff (beats 4..12), the take over 6..8, then the riff again.
    const clips = loadProject(dir).tracks[0].clips;
    expect(clips.map((c) => [c.name, c.start, c.length])).toEqual([
      ["riff", 4, 2],
      [take, 6, 2],
      ["riff", 8, 4],
    ]);
    expect(clips[2].loopStart).toBe(4);
  });

  it("gives a span back to the event's own material, then drops the take", async () => {
    const pass = { start: 4, end: 8, notes: [] };
    await run(`event take midi keys 2:1 ${JSON.stringify(pass)}`);
    const take = event().takes[0].ref;
    await run("event comp keys 2:1 riff 2:1 2:3");
    expect(event().comp).toEqual([{ take, from: "2:3", to: "3:1" }]);
    const h = await run(`event take remove keys 2:1 ${take}`);
    expect(h.lines.refuse).toEqual([]);
    expect(event()).toEqual({ ref: "riff", start: "2:1" });
  });

  it("refuses an event that is not there, and a take the event does not have", async () => {
    expect(
      (await run("event comp keys 9:1 riff 9:1 9:3")).lines.refuse.join(" "),
    ).toMatch(/no event at/);
    expect(
      (await run("event comp keys 2:1 nope 2:1 2:3")).lines.refuse.join(" "),
    ).toMatch(/no take "nope"/);
  });
});

describe("event take arm", () => {
  it("hands the event and the punch to the host, in beats, and disarm hands it null", async () => {
    const got: unknown[] = [];
    const h = testHost({
      songPath: dir,
      project: () => loadProject(dir),
      takeArm: (arm) => {
        got.push(arm);
        return true;
      },
    });
    await runCommand("event take arm keys 2:1 2:3 3:1", h, "cli");
    await runCommand("event take arm keys 2:1 2:2", h, "cli");
    await runCommand("event take disarm", h, "cli");
    expect(got).toEqual([
      { track: "keys", eventBeats: 4, punch: { from: 6, to: 8 } },
      { track: "keys", eventBeats: 4, punch: { from: 5 } },
      null,
    ]);
    await runCommand("event take arm keys 2:1 3:1 2:3", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(/must end after/);
  });
});

describe("event comp fade, and a move", () => {
  it("writes a seam crossfade, and a move carries takes, comp and crossfades along", async () => {
    const pass = { start: 6, end: 10, notes: [] };
    await run(`event take midi keys 2:1 ${JSON.stringify(pass)}`);
    const take = event().takes[0].ref;
    let h = await run("event comp fade keys 2:1 2:3 0:0:2");
    expect(h.lines.refuse).toEqual([]);
    expect(event().crossfades).toEqual([{ at: "2:3", length: "0:0:2" }]);

    h = await run("event move keys 2:1 4:1");
    expect(h.lines.refuse).toEqual([]);
    const ev = event();
    expect(ev.start).toBe("4:1");
    expect(ev.takes).toEqual([{ ref: take, start: "4:3" }]);
    expect(ev.comp).toEqual([{ take, from: "4:3", to: "5:3" }]);
    expect(ev.crossfades).toEqual([{ at: "4:3", length: "0:0:2" }]);

    await run("event comp fade keys 4:1 4:3 0");
    expect(event().crossfades).toBeUndefined();
  });

  it("never starts a span before its event", async () => {
    const pass = { start: 0, end: 8, notes: [] };
    await run(`event take midi keys 2:1 ${JSON.stringify(pass)}`);
    // The pass began a bar early: what is heard of it starts with the event.
    expect(event().comp[0].from).toBe("2:1");
  });
});
