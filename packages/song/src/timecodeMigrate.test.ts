import { parseDuration, parsePosition } from "@studio/song-schema/timecode";
import { describe, expect, it } from "vitest";
import { migrateTimecodes } from "./timecodeMigrate";

// The notation is MESURE:NOIRE:CROCHE:DOUBLECROCHE, and anything finer is TICKS rather than another
// colon. These pin that the rewrite says the same thing the old chain said — 4/4 throughout, so a
// beat is a quarter and a bar is four of them.

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
    // 0-based, so every field counts itself: "0:0:0:3" is 3 × 1/16 beat = 0.1875 = 180 ticks. Read
    // as a POSITION the same string is 0, since a position's fields start at 1 — a whole fade out.
    const { text } = run(`events:\n  - { ref: a, fadeIn: "0:0:0:3" }\n`);
    expect(text).toContain(`fadeIn: "0:0.180"`);
    expect(parseDuration("0:0.180", 4, 4)).toBeCloseTo(0.1875, 9);
    expect(parsePosition("0:0:0:3", 4, 4)).not.toBeCloseTo(0.1875, 9);
  });
});

describe("what it refuses to touch", () => {
  it("leaves a bare NUMBER alone — on a clip that is seconds, not a timecode", () => {
    // The same key means two different things by its spelling (see AudioClipSchema); rewriting
    // `from: 0.25` as a bar number would move the trim by minutes.
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
  /**
   * The rewrite reads with the OLD rule, so a second pass over its own output would read
   * `"1:1:1:2"` as a sixty-fourth rather than a semiquaver and move the song. A migration that
   * cannot be run twice is a trap, so anything already in the canonical new spelling is left alone.
   */
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

  /**
   * A deep chain can name a moment BETWEEN two ticks, and the short form's floor is one tick
   * (1/960 of a quarter). So the rewrite is not always exact, and the worst case is half a tick —
   * 0.28 ms at 110bpm. Reported rather than assumed, because "lossless" would be a claim.
   */
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
