// The take's picture is ACCUMULATED from frames that each carry only what is new, so the whole
// difficulty is knowing when to throw the total away. Every case here is a sequence of frames a
// real session produces, and each wrong answer looks like a rendering bug rather than a rule.

import { describe, expect, it } from "vitest";
import {
  EMPTY_TAKE,
  type EnvPoint,
  foldTake,
  type TakeFrame,
  type TakeView,
} from "./takeEnvelope";

const pt = (v: number): EnvPoint => ({ min: -v, max: v });
const frame = (over: Partial<TakeFrame> = {}): TakeFrame => ({
  recording: false,
  takes: [],
  envelope: [],
  ...over,
});

/** Run a run of frames through the fold, as the card does. */
const run = (frames: TakeFrame[], from: TakeView = EMPTY_TAKE): TakeView =>
  frames.reduce(foldTake, from);

describe("while a take is being made", () => {
  it("appends what each frame brought", () => {
    const v = run([
      frame({ recording: true, envelope: [pt(1)] }),
      frame({ recording: true, envelope: [pt(2), pt(3)] }),
      frame({ recording: true, envelope: [pt(4)] }),
    ]);
    expect(v.points.map((p) => p.max)).toEqual([1, 2, 3, 4]);
  });

  it("hands back the SAME object when a frame brought nothing", () => {
    // Identity, not equality: this is the frame that arrives 20 times a second, and a fresh
    // array each time would repaint the card for as long as the project is open.
    const a = run([frame({ recording: true, envelope: [pt(1)] })]);
    expect(foldTake(a, frame({ recording: true }))).toBe(a);
  });
});

describe("the three edges it starts over on", () => {
  it("drops the last take's picture when a new one starts", () => {
    const first = run([
      frame({ recording: true, envelope: [pt(1), pt(2)] }),
      frame({ recording: false, takes: [{ seconds: 2 }] }),
    ]);
    expect(first.points).toHaveLength(2);

    // Record again: what is on screen belongs to the take before this one.
    const second = foldTake(
      first,
      frame({ recording: true, takes: [{ seconds: 2 }], envelope: [pt(9)] }),
    );
    expect(second.points.map((p) => p.max)).toEqual([9]);
  });

  it("KEEPS the picture when recording stops — the take is finished, not gone", () => {
    const v = run([
      frame({ recording: true, envelope: [pt(1), pt(2)] }),
      frame({ recording: false, takes: [{ seconds: 2 }] }),
    ]);
    expect(v.points.map((p) => p.max)).toEqual([1, 2]);
    expect(v.recording).toBe(false);
  });

  it("takes the last frame's tail with it when the take closes", () => {
    // The engine drains what is left in the ring on stop, so the CLOSING frame carries points.
    const v = run([
      frame({ recording: true, envelope: [pt(1)] }),
      frame({ recording: false, takes: [{ seconds: 1 }], envelope: [pt(2)] }),
    ]);
    expect(v.points.map((p) => p.max)).toEqual([1, 2]);
  });

  it("empties when CLEAR pops the take that is on screen", () => {
    const v = run([
      frame({ recording: true, envelope: [pt(1), pt(2)] }),
      frame({ recording: false, takes: [{ seconds: 2 }] }),
      frame({ recording: false, takes: [] }), // clear
    ]);
    expect(v.points).toEqual([]);
  });

  it("survives a clear that leaves an EARLIER take behind", () => {
    // Two takes, the second cleared: the picture must not keep drawing the one that is gone.
    const v = run([
      frame({ recording: true, envelope: [pt(1)] }),
      frame({ recording: false, takes: [{ seconds: 1 }] }),
      frame({ recording: true, takes: [{ seconds: 1 }], envelope: [pt(5)] }),
      frame({ recording: false, takes: [{ seconds: 1 }, { seconds: 1 }] }),
      frame({ recording: false, takes: [{ seconds: 1 }] }), // clear the second
    ]);
    expect(v.points).toEqual([]);
    expect(v.takeCount).toBe(1);
  });
});

// --- what a RELOAD needs -------------------------------------------------------------------
//
// The frames above carry no `from`, which is the tolerated shape: an engine that does not say
// where its points start is appending. A current engine always says, and says 0 to a socket that
// just connected — which is the whole of how a card comes back showing the take still being made.

describe("a frame that says where its points start", () => {
  const at = (from: number, over: Partial<TakeFrame> = {}): TakeFrame =>
    frame({ from, ...over });

  it("appends when they start where the view got to", () => {
    const v = run([
      at(0, { recording: true, envelope: [pt(1), pt(2)] }),
      at(2, { recording: true, envelope: [pt(3)] }),
      at(3, { recording: true, envelope: [pt(4)] }),
    ]);
    expect(v.points.map((p) => p.max)).toEqual([1, 2, 3, 4]);
  });

  it("draws the whole take a reload arrived in the middle of", () => {
    // One frame, and it is the first this client ever saw: the engine rewound to 0 for it.
    const v = run([
      at(0, { recording: true, envelope: [pt(1), pt(2), pt(3), pt(4)] }),
    ]);
    expect(v.points.map((p) => p.max)).toEqual([1, 2, 3, 4]);
    expect(v.recording).toBe(true);
  });

  it("…and the finished take a reload arrived after", () => {
    // Not recording, and a take exists that this view has never counted — the `cleared` edge
    // reads that as "a different picture", which is exactly right for a client with no picture.
    const v = run([
      at(0, { takes: [{ seconds: 4 }], envelope: [pt(1), pt(2)] }),
    ]);
    expect(v.points.map((p) => p.max)).toEqual([1, 2]);
    expect(v.recording).toBe(false);
  });

  it("keeps only the tail when the engine resends what it already has", () => {
    // A SECOND client connecting rewinds the session's envelopes, so this one is sent the whole
    // picture again. Drawing it twice is the bug this offset exists to prevent.
    const v = run([
      at(0, { recording: true, envelope: [pt(1), pt(2)] }),
      at(0, { recording: true, envelope: [pt(1), pt(2), pt(3)] }),
    ]);
    expect(v.points.map((p) => p.max)).toEqual([1, 2, 3]);
  });

  it("takes the frame's word over its own where the two overlap", () => {
    const v = run([
      at(0, { recording: true, envelope: [pt(1), pt(9)] }),
      at(1, { recording: true, envelope: [pt(2), pt(3)] }),
    ]);
    // Position 1 is the frame's, not the 9 the view was holding there.
    expect(v.points.map((p) => p.max)).toEqual([1, 2, 3]);
  });

  it("blanks the picture when `clear` takes the take being recorded", () => {
    // Stopping pushes a take and popping removes it, so the COUNT never moves and neither edge
    // fires. The offset is what says the engine now holds nothing: from 0, with no points.
    const v = run([
      at(0, { recording: true, envelope: [pt(1), pt(2)] }),
      at(0, { recording: false, envelope: [] }),
    ]);
    expect(v.points).toEqual([]);
  });

  it("still hands back the SAME object on the idle frame", () => {
    const a = run([at(0, { recording: true, envelope: [pt(1)] })]);
    expect(foldTake(a, at(1, { recording: true }))).toBe(a);
  });
});
