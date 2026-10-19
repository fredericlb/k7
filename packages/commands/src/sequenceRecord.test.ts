// `sequence record` — a MIDI take on a lane with no sequence becomes one, placed where it was played.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordWindow, writeRecordedSequence } from "./verbs/sequenceRecord";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seq-record-"));
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeDoc(join(dir, "nodes", "keys.k7x"), {
    extends: "@meta/track",
    events: [],
  });
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
    const seq = wsData(join(dir, "sequences", `${id}.k7x`));
    expect(seq.to).toBe("2:1");
    expect(seq.notes).toEqual([
      { t: 1, d: 1, k: 60, v: 0.5 },
      { t: 2, d: 1, k: 64 },
    ]);
    expect(wsData(join(dir, "nodes", "keys.k7x")).events).toEqual([
      expect.objectContaining({ ref: id }),
    ]);
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
    expect(existsSync(join(dir, "sequences", "keys-rec-1.k7x"))).toBe(true);
  });
});
