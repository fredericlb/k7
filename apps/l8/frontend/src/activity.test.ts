// The activity an event block wears — the pure mapping behind ClipActivity. What matters:
// the floor is 0.5 (a quiet stretch still shows the block), the event's OWN peak is what
// reaches 1 (normalisation is per event, not per song), velocities ADD (a chord beats its
// loudest note), and a loop's activity repeats where the repeats play.

import { describe, expect, it } from "vitest";
import {
  activityMask,
  audioActivity,
  midiActivity,
  QUIET,
  toAlphas,
} from "./activity";
import type { WebNote } from "./types";

const note = (time: number, duration: number, vel?: number): WebNote => ({
  time,
  duration,
  key: 60,
  ...(vel === undefined ? {} : { vel }),
});

describe("toAlphas", () => {
  it("spans QUIET..1, with the loudest bucket at exactly 1", () => {
    expect(toAlphas([0, 0.4, 0.8])).toEqual([QUIET, 0.75, 1]);
  });

  it("an all-silent event sits at the floor, not at NaN", () => {
    expect(toAlphas([0, 0, 0])).toEqual([QUIET, QUIET, QUIET]);
  });

  it("normalises to the event's own peak — a quiet event still reaches 1 somewhere", () => {
    // Peaks of 0.1: quiet against the song, but ITS loudest point is full opacity.
    expect(toAlphas([0.05, 0.1])).toEqual([0.75, 1]);
  });
});

describe("audioActivity", () => {
  it("max-pools — a hit inside a quiet bucket is not averaged away", () => {
    // 4 samples into 2 buckets: the lone 1.0 owns its bucket entirely.
    expect(audioActivity([0, 1, 0.1, 0.1], 2)).toEqual([1, QUIET + 0.05]);
  });

  it("never makes more buckets than there are peaks", () => {
    expect(audioActivity([0.5, 1], 96)).toHaveLength(2);
  });
});

describe("midiActivity", () => {
  it("adds the velocities sounding at a position — a chord is louder than its loudest note", () => {
    // Two half-velocity notes together (bucket 0) vs one alone (bucket 1): 1.0 vs 0.5.
    const a = midiActivity(
      [note(0, 1, 0.5), note(0, 1, 0.5), note(1, 1, 0.5)],
      2,
      2,
    );
    expect(a).toEqual([1, 0.75]);
  });

  it("a note with no vel counts as the schema's default, 1", () => {
    const a = midiActivity([note(0, 1), note(1, 1, 0.5)], 2, 2);
    expect(a).toEqual([1, 0.75]);
  });

  it("a note sounds through every bucket it covers, and empty buckets sit at the floor", () => {
    const a = midiActivity([note(0, 2, 1)], 4, 4);
    expect(a).toEqual([1, 1, QUIET, QUIET]);
  });

  it("tiles a loop window across the span, as the block's repeats play", () => {
    // A one-beat note in a one-beat loop, spanning 3 beats: activity in every repeat.
    const a = midiActivity([note(0, 1, 1)], 3, 3, 0, 1);
    expect(a).toEqual([1, 1, 1]);
  });
});

describe("activityMask", () => {
  it("one stop per bucket, at the bucket's centre", () => {
    expect(activityMask([0.5, 1])).toBe(
      "linear-gradient(to right, rgb(0 0 0 / 0.5) 25%, rgb(0 0 0 / 1) 75%)",
    );
  });

  it("a single bucket is a flat mask, not a to-right gradient of one stop", () => {
    expect(activityMask([0.5])).toBe(
      "linear-gradient(rgb(0 0 0 / 0.5), rgb(0 0 0 / 0.5))",
    );
  });

  it("nothing to say, empty string — the caller falls back to the flat fill", () => {
    expect(activityMask([])).toBe("");
  });
});
