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
          recorders: {
            rec: rec({ seconds: 3, envelope: [{ min: -1, max: 1 }] }),
          },
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
    const same = {
      ...IDLE,
      recorders: { rec: rec({ recording: false, seconds: 0 }) },
    };
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

// --- the take a card arrives too late for ------------------------------------------------------
//
// The bug this exists for: the engine resends a take's whole picture in ONE frame when the socket
// connects, and the card that draws it mounts a second later. Accumulating in the card meant that
// frame was always already gone — a reload drew a take that looked like it had just started. The
// STORE keeps it instead, so whoever asks, whenever, gets the whole thing.

describe("the accumulated take", () => {
  const pts = (n: number, at = 0) =>
    Array.from({ length: n }, (_, i) => ({ min: -(at + i), max: at + i }));

  it("hands a LATE reader the whole picture, not the last delta", () => {
    const store = new EngineStore();
    // Frame 0 is the resend: the whole take, from 0. Nothing is subscribed yet — this is the
    // page still loading, which is exactly when it arrives.
    store.set({
      ...IDLE,
      recorders: { r: rec({ envelope: pts(40), from: 0 }) },
    });
    // …then the ordinary deltas, which is all a card mounting now would ever see by itself.
    store.set({
      ...IDLE,
      recorders: { r: rec({ envelope: pts(1, 40), from: 40 }) },
    });
    store.set({
      ...IDLE,
      recorders: { r: rec({ envelope: pts(1, 41), from: 41 }) },
    });
    expect(store.takeOf("r")?.points).toHaveLength(42);
  });

  it("keeps the SAME array while nothing moves, so a card does not repaint on every frame", () => {
    const store = new EngineStore();
    store.set({
      ...IDLE,
      recorders: { r: rec({ envelope: pts(3), from: 0 }) },
    });
    const first = store.takeOf("r")?.points;
    // A frame that brings no point and moves nothing is what an idle recorder sends 20 times a second.
    store.set({
      ...IDLE,
      playhead: 1,
      recorders: { r: rec({ envelope: [], from: 3 }) },
    });
    expect(store.takeOf("r")?.points).toBe(first);
  });

  it("does not draw a resent picture twice", () => {
    const store = new EngineStore();
    store.set({
      ...IDLE,
      recorders: { r: rec({ envelope: pts(3), from: 0 }) },
    });
    // A SECOND client connecting rewinds the session, so this one is sent the whole thing again.
    store.set({
      ...IDLE,
      recorders: { r: rec({ envelope: pts(4), from: 0 }) },
    });
    expect(store.takeOf("r")?.points).toHaveLength(4);
  });

  it("forgets a node the frames stop mentioning", () => {
    const store = new EngineStore();
    store.set({
      ...IDLE,
      recorders: { r: rec({ envelope: pts(3), from: 0 }) },
    });
    store.set({ ...IDLE, playhead: 2, recorders: {} });
    expect(store.takeOf("r")).toBeUndefined();
  });
});
