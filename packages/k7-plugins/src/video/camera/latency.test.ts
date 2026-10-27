import { describe, expect, it } from "vitest";
import {
  bufferTargets,
  MAX_TARGET_MS,
  sampleFromStats,
  totalMs,
} from "./latency";

describe("sampleFromStats", () => {
  it("is null before a frame was decoded", () => {
    expect(
      sampleFromStats([
        { type: "inbound-rtp", kind: "video", framesDecoded: 0 },
      ]),
    ).toBeNull();
  });

  it("adds half the round trip, the decode and one sender frame to the buffer's hold", () => {
    const s = sampleFromStats([
      {
        type: "candidate-pair",
        nominated: true,
        state: "succeeded",
        currentRoundTripTime: 0.04,
      },
      {
        type: "candidate-pair",
        nominated: false,
        state: "succeeded",
        currentRoundTripTime: 9,
      },
      {
        type: "inbound-rtp",
        kind: "video",
        framesDecoded: 100,
        totalDecodeTime: 0.5,
        jitterBufferEmittedCount: 100,
        jitterBufferDelay: 6,
      },
    ]);
    expect(s).not.toBeNull();
    expect(s?.bufferMs).toBeCloseTo(60);
    expect(s?.baseMs).toBeCloseTo(33 + 20 + 5);
    expect(totalMs(s as never)).toBeCloseTo(118);
  });
});

describe("bufferTargets", () => {
  it("leaves a lone lens alone", () => {
    expect(bufferTargets([{ baseMs: 80, bufferMs: 40 }])).toEqual([0]);
  });

  it("holds the quicker lenses back to the slowest floor", () => {
    expect(
      bufferTargets([
        { baseMs: 50, bufferMs: 20 },
        { baseMs: 200, bufferMs: 30 },
        { baseMs: 120, bufferMs: 500 },
      ]),
    ).toEqual([150, 0, 80]);
  });

  it("never asks for more than the cap", () => {
    expect(
      bufferTargets([
        { baseMs: 0, bufferMs: 0 },
        { baseMs: 9000, bufferMs: 0 },
      ]),
    ).toEqual([MAX_TARGET_MS, 0]);
  });
});
