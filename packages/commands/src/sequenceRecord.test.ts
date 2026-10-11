// `sequence record` — a MIDI take on a lane with no sequence becomes one, placed where it was played.

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
import { parse } from "yaml";
import { recordWindow, writeRecordedSequence } from "./verbs/sequenceRecord";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seq-record-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "nodes", "keys.yaml"),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the window a take is filed in", () => {
  it("starts on the bar of the first note and ends on a whole bar past the last", () => {
    // 4/4: a note at beat 5.5 lasting 4 beats starts in bar 2 and runs into bar 3.
    expect(recordWindow([{ t: 5.5, d: 4, k: 60 }], 4, 4)).toEqual({
      from: 4,
      bars: 2,
    });
  });
});

describe("sequence record", () => {
  it("writes the notes clip-local and places the sequence on the lane", () => {
    const { id, at } = writeRecordedSequence(
      dir,
      "keys",
      [
        { t: 5, d: 1, k: 60, v: 0.5 },
        { t: 6, d: 1, k: 64, v: 1 },
      ],
      4,
      4,
    );
    expect(id).toBe("keys-rec-1");
    expect(at).toBe("2:1");
    const seq = parse(
      readFileSync(join(dir, "sequences", `${id}.yaml`), "utf8"),
    );
    expect(seq.to).toBe("2:1");
    expect(seq.notes).toEqual([
      { t: 1, d: 1, k: 60, v: 0.5 },
      { t: 2, d: 1, k: 64 },
    ]);
    expect(readFileSync(join(dir, "nodes", "keys.yaml"), "utf8")).toContain(id);
  });

  it("never overwrites an earlier take", () => {
    writeRecordedSequence(dir, "keys", [{ t: 0, d: 1, k: 60 }], 4, 4);
    const { id } = writeRecordedSequence(
      dir,
      "keys",
      [{ t: 0, d: 1, k: 62 }],
      4,
      4,
    );
    expect(id).toBe("keys-rec-2");
    expect(existsSync(join(dir, "sequences", "keys-rec-1.yaml"))).toBe(true);
  });
});
