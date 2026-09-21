// `sequence double` — twice as long, playing twice.
//
// Through the DISPATCHER and asserting the FILE, like the other note verbs: what is pinned here is
// what a LENGTH is when the file states no window, and that the copies land inside the journal's
// one entry. The writer's own rules are packages/song-schema's doubleSequence.test.ts.

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
import { parse } from "yaml";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
let reloaded = 0;
let snapped: string[] = [];

const SEQ = `notes:
  - { t: 0, d: 1, k: 60 }
  - { t: 2.5, d: 0.5, k: 64, v: 0.8 }
`;

function song(seq = SEQ, place = ""): string {
  const d = mkdtempSync(join(tmpdir(), "td-seqdouble-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  mkdirSync(join(d, "sequences"), { recursive: true });
  writeFileSync(join(d, "sequences", "melody.yaml"), seq, "utf8");
  if (place) {
    mkdirSync(join(d, "nodes"), { recursive: true });
    writeFileSync(join(d, "nodes", "lead.yaml"), place, "utf8");
  }
  return d;
}

/** A lane placing the sequence — the half of the act that lives outside the sequence file. */
const LANE = `extends: "@meta/track"
events:
  - { ref: melody, start: "1:1:1", loop: 4 }
`;
const lane = () => readFileSync(join(dir, "nodes", "lead.yaml"), "utf8");

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
  parse(readFileSync(join(dir, "sequences", "melody.yaml"), "utf8"), {
    version: "1.2",
  }).notes as { t: number; k: number }[];
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
    expect(snapped).toEqual([join(dir, "sequences", "melody.yaml")]);
  });

  it("refuses a sequence that is not there, by name", async () => {
    await run("sequence double nope");
    expect(logs.join("\n")).toMatch(/no sequence file: sequences\/nope\.yaml/);
    expect(reloaded).toBe(0);
  });

  it("refuses an EMPTY sequence rather than making it twice as empty", async () => {
    dir = song("notes: []\n");
    await run("sequence double melody");
    expect(logs.join("\n")).toMatch(/no notes/);
    expect(reloaded).toBe(0);
  });

  it("halves the passes wherever the sequence is LOOPED", async () => {
    // The window doubled, so four passes of it would be twice the arrangement — see song-edit's docs/sequenceLoops.md.
    dir = song(SEQ, LANE);
    await run("sequence double melody");
    expect(lane()).toContain("loop: 2");
    expect(logs.join("\n")).toMatch(/1 placement\(s\) now loop half/);
  });

  it("names a placement it could NOT halve, rather than leaving it unsaid", async () => {
    dir = song(SEQ, LANE.replace("loop: 4", "loop: 3"));
    await run("sequence double melody");
    expect(lane()).toContain("loop: 3");
    expect(logs.join("\n")).toMatch(/lead at 1:1:1 still loops 3/);
  });

  it("says what it needs when told no sequence at all", async () => {
    await run("sequence double");
    expect(logs.join("\n")).toMatch(/usage: sequence double <sequence>/);
  });
});
