// How hard a cable ripples — one number per wire, arrived at three different ways because the
// three kinds of signal are not the same quantity. What is pinned here is the SHAPE of each
// mapping, since a wrong curve reads as "the wobble is broken" rather than as a wrong number.

import { describe, expect, it } from "vitest";
import {
  audioFlow,
  FLOW_FLOOR_DB,
  flowOf,
  midiFlow,
  type NodeFlow,
  STILL,
  seedFlows,
  seedsEq,
  videoFlow,
} from "./flow";

describe("an audio cable", () => {
  it("throws at 0 dB and barely stirs at the floor", () => {
    expect(audioFlow(0)).toBe(1);
    expect(audioFlow(FLOW_FLOOR_DB + 1)).toBeCloseTo(1 / 80, 6);
  });

  it("hangs still at the floor and below — dead, not merely faint", () => {
    expect(audioFlow(FLOW_FLOOR_DB)).toBe(STILL);
    expect(audioFlow(-120)).toBe(STILL);
    expect(audioFlow(Number.NEGATIVE_INFINITY)).toBe(STILL);
  });

  it("is linear in DECIBELS, which is what a level is", () => {
    // Half the scale is half the dB, not half the amplitude: -40 is the middle of -80..0, and
    // mapping the amplitude instead would put everything under -20 dB at the bottom together.
    expect(audioFlow(-40)).toBeCloseTo(0.5, 6);
    expect(audioFlow(-20)).toBeCloseTo(0.75, 6);
    expect(audioFlow(-60)).toBeCloseTo(0.25, 6);
  });

  it("clamps above unity rather than throwing harder", () => {
    expect(audioFlow(6)).toBe(1);
  });
});

describe("a MIDI cable", () => {
  it("is the velocities sounding, against the busiest that lane gets", () => {
    expect(midiFlow(2, 4)).toBe(0.5);
    expect(midiFlow(4, 4)).toBe(1);
  });

  it("counts velocity, not notes: four soft notes are not a loud chord", () => {
    // 4 notes at 0.25 and 1 note at 1 put the same load on the wire, which is the whole point of
    // multiplying by velocity rather than counting — the same rule activity.ts paints a block by.
    expect(midiFlow(4 * 0.25, 4)).toBe(midiFlow(1, 4));
  });

  it("hangs still with nothing sounding, and with nothing to compare against", () => {
    expect(midiFlow(0, 4)).toBe(STILL);
    expect(midiFlow(2, 0)).toBe(STILL);
  });
});

describe("a video cable", () => {
  it("is BINARY — a dark shot is still a shot", () => {
    expect(videoFlow(true)).toBe(1);
    expect(videoFlow(false)).toBe(STILL);
  });
});

describe("which number a cable reads", () => {
  const seed: NodeFlow = { audio: 0.2, midi: 0.6, video: 1 };

  it("takes the one matching what it carries", () => {
    expect(flowOf(seed, "audio")).toBe(0.2);
    expect(flowOf(seed, "midi")).toBe(0.6);
    expect(flowOf(seed, "video")).toBe(1);
  });

  it("reads an EVENT wire as notes, being the notes it is", () => {
    expect(flowOf(seed, "event")).toBe(0.6);
  });

  it("falls back to audio for a cable that says nothing", () => {
    expect(flowOf(seed, undefined)).toBe(0.2);
  });
});

describe("the seeds a frame builds", () => {
  it("gives one lane all three numbers, so its two wires can differ", () => {
    // The case the whole design is for: a sequences lane feeding an instrument. The MIDI cable
    // into it moves with the notes, the audio cable out of it with the meter.
    const seeds = seedFlows({
      melody: { db: -40, notes: { load: 4, peak: 4 } },
    });
    expect(seeds.get("melody")).toEqual({ audio: 0.5, midi: 1, video: 0 });
  });

  it("leaves out a lane that puts out nothing at all", () => {
    expect(seedFlows({ quiet: { db: -100 } }).size).toBe(0);
    expect(seedFlows({ nothing: {} }).size).toBe(0);
  });

  it("keeps a SILENT lane that is showing a picture", () => {
    const seeds = seedFlows({ cam: { showing: true } });
    expect(seeds.get("cam")).toEqual({ audio: 0, midi: 0, video: 1 });
  });

  it("reads an absent level as nothing to meter, not as silence at 0 dB", () => {
    expect(seedFlows({ lane: {} }).has("lane")).toBe(false);
  });
});

describe("seedsEq", () => {
  const a = new Map([["m", { audio: 0.5, midi: 0, video: 0 }]]);
  it("is what keeps a meter frame from re-walking the graph", () => {
    expect(
      seedsEq(a, new Map([["m", { audio: 0.5, midi: 0, video: 0 }]])),
    ).toBe(true);
    expect(
      seedsEq(a, new Map([["m", { audio: 0.6, midi: 0, video: 0 }]])),
    ).toBe(false);
    expect(seedsEq(a, new Map())).toBe(false);
  });
});
