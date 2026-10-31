import { describe, expect, it } from "vitest";
import { songSyncRows } from "./songSyncRows";

const words = {
  checking: "checking",
  upToDate: "up to date",
  updated: (n: number) => `${n} updated`,
  gone: (n: number) => `${n} gone`,
};

describe("songSyncRows", () => {
  it("words the check by what it found, and names a song by its path under the family", () => {
    const rows = songSyncRows(
      [
        { key: "check:1", kind: "check", phase: "running" },
        {
          key: "song:1:songs/A/B/S",
          kind: "song",
          path: "songs/A/B/S",
          phase: "running",
        },
      ],
      words,
      new Set(),
    );
    expect(rows.map((r) => r.label)).toEqual(["checking", "A / B / S"]);
    const done = songSyncRows(
      [{ key: "check:1", kind: "check", phase: "done", updated: 2, gone: 1 }],
      words,
      new Set(),
    );
    expect(done[0]).toMatchObject({
      phase: "done",
      label: "2 updated · 1 gone",
    });
    expect(
      songSyncRows(
        [{ key: "check:2", kind: "check", phase: "done" }],
        words,
        new Set(),
      )[0].label,
    ).toBe("up to date");
  });

  it("hands a finished job over once, so the manager's linger is the last word", () => {
    const handed = new Set<string>();
    const job = { key: "check:3", kind: "check", phase: "done" } as const;
    expect(songSyncRows([job], words, handed)).toHaveLength(1);
    expect(songSyncRows([job], words, handed)).toHaveLength(0);
  });
});
