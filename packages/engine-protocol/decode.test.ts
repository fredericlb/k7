// Tests for the shared decoders and outbox: what both clients fill in when a frame leaves a field out.

import { describe, expect, it } from "vitest";
import { decodeIoLevels, decodeState, Outbox } from "./decode.ts";

describe("decodeState", () => {
  it("fills an empty frame with silence", () => {
    expect(decodeState({})).toEqual({
      playing: false,
      playhead: 0,
      levels: [],
      inputLevels: [],
      armed: [],
      recordEnabled: false,
      master: -100,
      masterClipped: false,
      waveform: {},
      platters: {},
      recorders: {},
    });
  });

  // Absent rather than empty: a store keeps the last `load`, and a loop that is not sent is not off.
  it("leaves loop and load out when the frame carries none", () => {
    const s = decodeState({ playing: true });
    expect("loop" in s).toBe(false);
    expect("load" in s).toBe(false);
  });

  it("keeps the loop, platters and recorders a frame carries", () => {
    const s = decodeState({
      loop: { on: true, end: 4 },
      platters: { p: 1.5 },
      recorders: {
        r: { recording: true, seconds: 2, takes: [], envelope: [], from: 0 },
      },
    });
    expect(s.loop).toEqual({ on: true, start: 0, end: 4 });
    expect(s.platters).toEqual({ p: 1.5 });
    expect(s.recorders?.r.recording).toBe(true);
  });
});

describe("decodeIoLevels", () => {
  it("keeps the tuner and the devices", () => {
    expect(
      decodeIoLevels({
        inputs: [-12],
        pitches: [440],
        clarity: [0.9],
        devices: [{ name: "In 1", channels: [1], enabled: true }],
      }),
    ).toEqual({
      inputs: [-12],
      master: -100,
      pitches: [440],
      clarity: [0.9],
      devices: [{ name: "In 1", channels: [1], enabled: true }],
    });
  });
});

describe("Outbox", () => {
  it("drops the oldest past its bound", () => {
    const o = new Outbox(2, 1000);
    for (const s of ["a", "b", "c"]) o.push(s, 0);
    expect(o.drain(0)).toEqual(["b", "c"]);
  });

  it("replays nothing past its age, and empties either way", () => {
    const o = new Outbox(10, 1000);
    o.push("old", 0);
    o.push("new", 900);
    expect(o.drain(1500)).toEqual(["new"]);
    expect(o.size).toBe(0);
  });
});
