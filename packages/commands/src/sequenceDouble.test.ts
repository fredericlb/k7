// `sequence double` — twice as long, playing twice.
//
// Through the DISPATCHER and asserting the FILE, like the other note verbs: what is pinned here is
// what a LENGTH is when the file states no window, and that the copies land inside the journal's
// one entry. The writer's own rules are packages/song-schema's doubleSequence.test.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
let reloaded = 0;
let snapped: string[] = [];

const SEQ = [
  { t: 0, d: 1, k: 60 },
  { t: 2.5, d: 0.5, k: 64, v: 0.8 },
];

/** A lane placing the sequence — the half of the act that lives outside the sequence file. */
const LANE = {
  extends: "@meta/track",
  events: [{ ref: "melody", start: "1:1:1", loop: 4 }],
};

function song(seq: unknown[] = SEQ, place?: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), "td-seqdouble-"));
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeDoc(join(d, "sequences", "melody.k7x"), { notes: seq });
  if (place) writeDoc(join(d, "nodes", "lead.k7x"), place);
  return d;
}

const laneLoop = () =>
  (wsData(join(dir, "nodes", "lead.k7x")).events as { loop?: number }[])[0]
    ?.loop;

const host = (num = 4, den = 4) =>
  ({
    songPath: dir,
    project: () => ({
      tracks: [],
      groups: [],
      timeSigNumerator: num,
      timeSigDenominator: den,
    }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    snapshot: (f: string) => snapped.push(f),
    reload: () => {
      reloaded++;
    },
  }) as never;

const notes = () =>
  wsData(join(dir, "sequences", "melody.k7x")).notes as {
    t: number;
    k: number;
  }[];
const run = (line: string, num?: number, den?: number) =>
  runCommand(line, host(num, den), "cli");

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  snapped = [];
  dir = song();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sequence double", () => {
  it("plays the pattern again one BAR-ROUNDED extent later", async () => {
    // The notes reach beat 3 and the sequence states no window, so in 4/4 it is four beats long.
    await run("sequence double melody");
    expect(notes().map((n) => n.t)).toEqual([0, 2.5, 4, 6.5]);
    expect(reloaded).toBe(1);
  });

  it("reads the bar off the project's SIGNATURE", async () => {
    await run("sequence double melody", 3, 4);
    expect(notes().map((n) => n.t)).toEqual([0, 2.5, 3, 5.5]);
  });

  it("backs the file up first, so one press is one Ctrl+Z", async () => {
    await run("sequence double melody");
    expect(snapped).toEqual([join(dir, "sequences", "melody.k7x")]);
  });

  it("refuses a sequence that is not there, by name", async () => {
    await run("sequence double nope");
    expect(logs.join("\n")).toMatch(/no sequence file: sequences\/nope\.k7x/);
    expect(reloaded).toBe(0);
  });

  it("refuses an EMPTY sequence rather than making it twice as empty", async () => {
    dir = song([]);
    await run("sequence double melody");
    expect(logs.join("\n")).toMatch(/no notes/);
    expect(reloaded).toBe(0);
  });

  it("halves the passes wherever the sequence is LOOPED", async () => {
    // The window doubled, so four passes of it would be twice the arrangement — see song-edit's docs/sequenceLoops.md.
    dir = song(SEQ, LANE);
    await run("sequence double melody");
    expect(laneLoop()).toBe(2);
    expect(logs.join("\n")).toMatch(/1 placement\(s\) now loop half/);
  });

  it("names a placement it could NOT halve, rather than leaving it unsaid", async () => {
    dir = song(SEQ, {
      ...LANE,
      events: [{ ...LANE.events[0], loop: 3 }],
    });
    await run("sequence double melody");
    expect(laneLoop()).toBe(3);
    expect(logs.join("\n")).toMatch(/lead at 1:1:1 still loops 3/);
  });

  it("says what it needs when told no sequence at all", async () => {
    await run("sequence double");
    expect(logs.join("\n")).toMatch(/usage: sequence double <sequence>/);
  });
});
