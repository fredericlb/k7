// The rule these all serve: a correction outlives the detection it corrects. Everything the engine found can
// be re-found at another sensitivity; what somebody said by hand must still be true afterwards.

import { describe, expect, it } from "vitest";
import { addOnset, moveOnset, removeOnset, resolveOnsets } from "./onsets";

describe("resolving what a clip's onsets are", () => {
  it("is just the detected set when nothing was corrected", () => {
    expect(resolveOnsets([0.5, 1.0], undefined)).toEqual([0.5, 1.0]);
    expect(resolveOnsets([0.5, 1.0], {})).toEqual([0.5, 1.0]);
  });

  it("drops a removed one and keeps an added one, in time order", () => {
    expect(
      resolveOnsets([0.5, 1.0, 1.5], { removed: [1.0], added: [0.2] }),
    ).toEqual([0.2, 0.5, 1.5]);
  });

  it("matches a removal that the detector has since moved slightly", () => {
    // The same hit, re-detected a few milliseconds off: the removal still means it.
    expect(resolveOnsets([1.008], { removed: [1.0] })).toEqual([]);
    // …but not a different hit a beat away.
    expect(resolveOnsets([1.5], { removed: [1.0] })).toEqual([1.5]);
  });

  it("does not double an addition the detector has caught up with", () => {
    // Raise the sensitivity and the hit you added by hand appears on its own.
    expect(resolveOnsets([1.0], { added: [1.004] })).toEqual([1.0]);
  });
});

describe("editing", () => {
  it("records a removal against the DETECTED time, not the pointer's", () => {
    // So the record keeps naming the same onset after a re-detection.
    expect(removeOnset(undefined, [1.0], 1.009)).toEqual({ removed: [1.0] });
  });

  it("undoes an addition rather than stacking a removal on it", () => {
    const added = addOnset(undefined, 2.0);
    expect(added).toEqual({ added: [2.0] });
    expect(removeOnset(added, [], 2.0)).toEqual({});
  });

  it("undoes a removal rather than stacking an addition on it", () => {
    const removed = removeOnset(undefined, [1.0], 1.0);
    expect(addOnset(removed, 1.0)).toEqual({});
  });

  it("moves one as a removal plus an addition", () => {
    const moved = moveOnset(undefined, [1.0], 1.0, 1.25);
    expect(moved).toEqual({ added: [1.25], removed: [1.0] });
    expect(resolveOnsets([1.0], moved)).toEqual([1.25]);
  });

  it("keeps a move true after the detector answers differently", () => {
    // The whole point: re-detect at another sensitivity and the hand-placed one is still where it was put,
    // and the one refused is still refused.
    const moved = moveOnset(undefined, [1.0], 1.0, 1.25);
    expect(resolveOnsets([0.4, 1.006, 1.9], moved)).toEqual([0.4, 1.25, 1.9]);
  });

  it("writes no block at all once the corrections cancel out", () => {
    // An untouched clip must not grow an `onsets:` key, and one edited back to nothing must lose it.
    expect(removeOnset(addOnset(undefined, 3.0), [], 3.0)).toEqual({});
  });
});
