// `sequence note velocity` — what the piano roll's velocity drag commits.
//
// Through the DISPATCHER and asserting the FILE, for the reason moduleAlternative.test.ts gives:
// a command that reports one state and writes another is the bug a writer-only test cannot see.
// The drag hands over a pixel position, so what is pinned here is the arithmetic around the write
// — the clamp, the rounding, and `1` meaning "say nothing" rather than "write the default".

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

const SEQ = `notes:
  - { t: 0, d: 1, k: 60 }
  - { t: 2, d: 1, k: 64, v: 0.4 }
`;

function song(seq = SEQ): string {
  const d = mkdtempSync(join(tmpdir(), "td-notevel-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  mkdirSync(join(d, "sequences"), { recursive: true });
  writeFileSync(join(d, "sequences", "melody.yaml"), seq, "utf8");
  return d;
}

const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;

const notes = () =>
  parse(readFileSync(join(dir, "sequences", "melody.yaml"), "utf8"), {
    version: "1.2",
  }).notes;

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  dir = song();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sequence note velocity", () => {
  it("writes the velocity of the note it names, and re-reads the project", async () => {
    await runCommand("sequence note velocity melody C4 0 0.7", host(), "cli");
    expect(notes()[0]).toEqual({ t: 0, d: 1, k: 60, v: 0.7 });
    expect(notes()[1]).toEqual({ t: 2, d: 1, k: 64, v: 0.4 }); // its neighbour is untouched
    expect(reloaded).toBe(1);
  });

  it("takes a MIDI number as readily as a name", async () => {
    await runCommand("sequence note velocity melody 64 2 0.9", host(), "cli");
    expect(notes()[1].v).toBe(0.9);
  });

  it("CLEARS the field at 1 rather than writing the schema's own default", async () => {
    await runCommand("sequence note velocity melody 64 2 1", host(), "cli");
    expect(notes()[1]).toEqual({ t: 2, d: 1, k: 64 });
  });

  it("clamps a drag that ran past the note's edges", async () => {
    // The gesture hands over a pixel, and past the top means "full" — which is the clearing case.
    await runCommand("sequence note velocity melody C4 0 -3", host(), "cli");
    expect(notes()[0].v).toBe(0);
    await runCommand("sequence note velocity melody C4 0 4", host(), "cli");
    expect(notes()[0].v).toBeUndefined();
  });

  it("rounds to two decimals, so a diff stays readable", async () => {
    await runCommand(
      "sequence note velocity melody C4 0 0.73333333",
      host(),
      "cli",
    );
    expect(notes()[0].v).toBe(0.73);
  });

  it("says so and writes NOTHING when the note is not there", async () => {
    await runCommand("sequence note velocity melody C4 9 0.5", host(), "cli");
    expect(logs.join(" ")).toMatch(/no note/);
    expect(notes()[0].v).toBeUndefined();
    expect(reloaded).toBe(0);
  });

  it("says so when the sequence file is not there", async () => {
    await runCommand("sequence note velocity nope C4 0 0.5", host(), "cli");
    expect(logs.join(" ")).toContain("no sequence file");
    expect(reloaded).toBe(0);
  });

  it("refuses a note name it cannot read", async () => {
    // Refused by the ARG SPEC (`type: note`), before the handler is even called — which is why the
    // message names the parameter. The handler keeps its own check anyway, as `sequence note new`
    // does beside it: a caller reaching a handler directly is not covered by the spec.
    await runCommand("sequence note velocity melody H9 0 0.5", host(), "cli");
    expect(logs.join(" ")).toMatch(/expects a note name/);
    expect(reloaded).toBe(0);
  });

  it("asks for what it needs when an argument is missing", async () => {
    await runCommand("sequence note velocity melody C4 0", host(), "cli");
    expect(logs.join(" ")).toContain("usage:");
    expect(reloaded).toBe(0);
  });
});
