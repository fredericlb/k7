import { describe, expect, it } from "vitest";
import { barBeat, takeCounter } from "./takeCounter";

// The counter in the clip panel's header. The bug it replaces: the start beat was captured once per
// MOUNT and the panel outlives its take, so from the second take onward it measured against the
// first take's start — while the playhead it compared to is an absolute position in the song. A
// take punched in at bar 15 read 56 beats the instant it began.
//
// 4/4: one bar is four beats, so a one-bar count-in is a pre-roll of 4.

describe("the pre-roll", () => {
  it("counts down whole beats to the take", () => {
    expect(takeCounter(0, 0, 4)).toEqual({ phase: "count-in", beats: 4 });
    expect(takeCounter(0, 1, 4)).toEqual({ phase: "count-in", beats: 3 });
    expect(takeCounter(0, 3.5, 4)).toEqual({ phase: "count-in", beats: 1 });
  });

  it("measures from where THIS take started, not from bar one", () => {
    // The whole bug, as one assertion: punched in at bar 15 (beat 56) with a bar of count-in.
    expect(takeCounter(56, 56, 4)).toEqual({ phase: "count-in", beats: 4 });
    expect(takeCounter(56, 58, 4)).toEqual({ phase: "count-in", beats: 2 });
    expect(takeCounter(56, 60, 4)).toEqual({ phase: "recording", beats: 0 });
  });

  it("is skipped entirely when the project asks for none", () => {
    expect(takeCounter(56, 56, 0)).toEqual({ phase: "recording", beats: 0 });
  });

  it("can never show more than the pre-roll it is counting", () => {
    // A playhead that jumped BACKWARDS — the transport relocating, a stale start beat surviving
    // some future refactor — used to print the difference. It now stops at the pre-roll's length.
    expect(takeCounter(500, 4, 4)).toEqual({ phase: "count-in", beats: 4 });
  });
});

describe("the take", () => {
  it("counts beats from the end of the pre-roll", () => {
    expect(takeCounter(0, 4, 4)).toEqual({ phase: "recording", beats: 0 });
    expect(takeCounter(0, 9.9, 4)).toEqual({ phase: "recording", beats: 5 });
  });

  it("never runs for less than nothing", () => {
    expect(takeCounter(0, -20, 0).beats).toBe(0);
  });
});

describe("bar:beat", () => {
  it("is 1-based, and wraps on the bar", () => {
    expect(barBeat(0, 4)).toEqual({ bar: 1, beat: 1 });
    expect(barBeat(3, 4)).toEqual({ bar: 1, beat: 4 });
    expect(barBeat(4, 4)).toEqual({ bar: 2, beat: 1 });
    expect(barBeat(9, 4)).toEqual({ bar: 3, beat: 2 });
  });

  it("survives a nonsense time signature rather than dividing by zero", () => {
    expect(barBeat(5, 0)).toEqual({ bar: 6, beat: 1 });
  });
});
