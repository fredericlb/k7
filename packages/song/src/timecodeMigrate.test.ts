import { parseDuration, parsePosition } from "@studio/song-schema/timecode";
import { describe, expect, it } from "vitest";
import { migrateTimecodes } from "./timecodeMigrate";

// Anything finer than a semiquaver is TICKS rather than another colon, and 4/4 throughout.

const run = (t: string) => migrateTimecodes(t, 4, 4);

describe("shortening the chain", () => {
  it("turns sub-beat levels into ticks", () => {
    // "1:1:1:3" is two sixteenths of a sixteenth in: 2 × 1/16 beat = 0.125 beats = 120 ticks.
    const { text, changes } = run(
      `events:\n  - { ref: a, start: "1:1:1:3" }\n`,
    );
    expect(text).toContain(`start: "1:1.120"`);
    expect(changes).toHaveLength(1);
    expect(parsePosition("1:1.120", 4, 4)).toBeCloseTo(0.125, 9);
  });

  it("leaves a timecode that is already short exactly as it is", () => {
    const src = `events:\n  - { ref: a, start: "25:1" }\n`;
    expect(run(src).text).toBe(src);
    expect(run(src).changes).toEqual([]);
  });

  it("reads a fade as a DURATION, not a position", () => {
    // 0-based: "0:0:0:3" is 180 ticks, where a POSITION would read the same string as 0.
    const { text } = run(`events:\n  - { ref: a, fadeIn: "0:0:0:3" }\n`);
    expect(text).toContain(`fadeIn: "0:0.180"`);
    expect(parseDuration("0:0.180", 4, 4)).toBeCloseTo(0.1875, 9);
    expect(parsePosition("0:0:0:3", 4, 4)).not.toBeCloseTo(0.1875, 9);
  });
});

describe("what it refuses to touch", () => {
  it("leaves a bare NUMBER alone — on a clip that is seconds, not a timecode", () => {
    // The key means two things by its spelling: `from: 0.25` as a bar would move the trim by minutes.
    const src = `source: clips/k.wav\nfrom: 0.25\nto: 1.5\n`;
    expect(run(src).text).toBe(src);
  });

  it("leaves keys that are not time fields", () => {
    const src = `name: "1:2:3:4"\nref: "5:5:5:5"\n`;
    expect(run(src).text).toBe(src);
  });

  it("keeps the file's comments and shape — it splices, it does not re-serialise", () => {
    const src = [
      "# the verse take",
      "events:",
      '  - { ref: a, start: "1:1:1:3" }  # bar 1',
      "",
      "  # and the chorus",
      '  - { ref: b, start: "9:1" }',
      "",
    ].join("\n");
    const { text } = run(src);
    expect(text).toContain("# the verse take");
    expect(text).toContain("# bar 1");
    expect(text).toContain("# and the chorus");
    expect(text).toContain(`- { ref: b, start: "9:1" }`);
    expect(text.split("\n")).toHaveLength(src.split("\n").length);
  });
});

describe("running it twice", () => {
  /** Reading with the OLD rule, a second pass would move the song, so canonical text is left alone. */
  it("is a no-op the second time", () => {
    const once = run(
      `events:\n  - { ref: a, to: "5:3:3:4:1:2:3:3", start: "46:3:3" }\n`,
    );
    expect(once.changes.length).toBe(2);
    const twice = run(once.text);
    expect(twice.changes).toEqual([]);
    expect(twice.text).toBe(once.text);
  });

  it("leaves a canonical value untouched even when it looks convertible", () => {
    // "1:1:2" is half a beat and is exactly what the writer emits for it.
    const src = `events:\n  - { ref: a, start: "1:1:2" }\n`;
    expect(run(src).changes).toEqual([]);
  });
});

describe("what it says about rounding", () => {
  it("reports nothing when the value lands on a whole tick", () => {
    expect(
      run(`events:\n  - { ref: a, start: "1:1:1:3" }\n`).changes[0].driftBeats,
    ).toBe(0);
  });

  /** The floor is one tick, so the rewrite can be half a tick off — reported rather than claimed. */
  it("measures the rounding when it cannot land on one", () => {
    const { changes } = run(`events:\n  - { ref: a, to: "5:3:3:4:1:2:3:3" }\n`);
    expect(changes).toHaveLength(1);
    expect(changes[0].driftBeats).toBeGreaterThan(0);
    expect(changes[0].driftBeats).toBeLessThanOrEqual(0.5 / 960);
  });

  it("still round-trips every rewrite to within half a tick", () => {
    const deep = [
      "5:3:3:4:1:2:3:3",
      "12:4:4:1:4:1:2:3",
      "1:3:3:1:4:3:4:3",
      "9:1:4:1:1:2:2:3",
    ];
    for (const tc of deep) {
      const { changes } = run(`events:\n  - { ref: a, to: "${tc}" }\n`);
      expect(changes[0].driftBeats).toBeLessThanOrEqual(0.5 / 960);
    }
  });
});
