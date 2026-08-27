// The store drops a frame that says exactly what the last one said — which is most of them, an
// idle engine sending 20 a second. What is pinned here is the OPPOSITE: the frames that must get
// through, and one family of them is invisible to every field the transport owns.
//
// A recorder node is free-running (engine/moteur/docs/recorder.md): a rig captures with the
// transport stopped, no track armed and every meter at the floor. Every equality above the
// recorders would call two such frames identical, and the take would never appear to grow.

import type { EngineState, RecorderState } from "@studio/engine-protocol";
import { describe, expect, it } from "vitest";
import { EngineStore } from "./engineStore";

const IDLE: EngineState = {
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
};

const rec = (over: Partial<RecorderState> = {}): RecorderState => ({
  recording: true,
  seconds: 1,
  takes: [],
  envelope: [],
  from: 0,
  ...over,
});

/** How many times the store told anybody, over these frames. */
function notifications(frames: EngineState[]): number {
  const store = new EngineStore();
  let n = 0;
  store.subscribe(() => {
    n++;
  });
  for (const f of frames) store.set(f);
  return n;
}

describe("a frame nothing else would notice", () => {
  it("gets through when a take grows", () => {
    // Nothing but `seconds` moves: no transport, no meter, no armed track.
    expect(
      notifications([
        { ...IDLE, recorders: { rec: rec({ seconds: 1 }) } },
        { ...IDLE, recorders: { rec: rec({ seconds: 2 }) } },
      ]),
    ).toBe(2);
  });

  it("gets through when the record light turns on", () => {
    expect(
      notifications([
        { ...IDLE, recorders: { rec: rec({ recording: false, seconds: 0 }) } },
        { ...IDLE, recorders: { rec: rec({ recording: true, seconds: 0 }) } },
      ]),
    ).toBe(2);
  });

  it("gets through when envelope points arrive", () => {
    // The points are what the card DRAWS, and they are sent to be appended: a frame carrying any
    // at all is new material, even with every other number unchanged.
    expect(
      notifications([
        { ...IDLE, recorders: { rec: rec({ seconds: 3 }) } },
        {
          ...IDLE,
          recorders: { rec: rec({ seconds: 3, envelope: [{ min: -1, max: 1 }] }) },
        },
      ]),
    ).toBe(2);
  });

  it("gets through when a take is finished, and when one is cleared", () => {
    const take = { file: "a.wav", seconds: 4 };
    expect(
      notifications([
        { ...IDLE, recorders: { rec: rec({ takes: [] }) } },
        { ...IDLE, recorders: { rec: rec({ takes: [take] }) } },
        { ...IDLE, recorders: { rec: rec({ takes: [] }) } },
      ]),
    ).toBe(3);
  });
});

describe("…and one that says nothing new is still dropped", () => {
  it("holds its peace for an idle recorder", () => {
    // Drained empty twice over is the SAME frame, and this is the case that runs 20 times a
    // second for as long as a project has a recorder in it.
    const same = { ...IDLE, recorders: { rec: rec({ recording: false, seconds: 0 }) } };
    expect(notifications([same, { ...same }, { ...same }])).toBe(1);
  });

  it("holds its peace with no recorder at all", () => {
    // ZERO, not one: the store STARTS idle, so the first of these says nothing new either.
    expect(notifications([{ ...IDLE }, { ...IDLE }])).toBe(0);
  });

  it("still notices everything it noticed before", () => {
    // The recorder arm is an addition, not a replacement — one case from each of the others.
    // One notification apiece, the idle frame ahead of each being the store's own start.
    expect(notifications([IDLE, { ...IDLE, playing: true }])).toBe(1);
    expect(notifications([IDLE, { ...IDLE, playhead: 2 }])).toBe(1);
    expect(notifications([IDLE, { ...IDLE, armed: ["gtr"] }])).toBe(1);
    expect(notifications([IDLE, { ...IDLE, platters: { deckA: 1 } }])).toBe(1);
  });
});
