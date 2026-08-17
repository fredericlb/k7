/**
 * The bound `clip trim` looks inside — and the rule that an argument may only ever NARROW it.
 *
 * A clip's window is the material it plays; a placement carries one too, and the clip panel opened
 * on an event shows a slice of the take rather than all of it. A gate that reached outside what was
 * on screen would cut on evidence nobody could see, so the panel hands the event's window down as
 * `from`/`to`. What the command WRITES is still the clip's window, which every placement shares —
 * moving one placement alone is `event resize`, and this is deliberately not that.
 */

import { describe, expect, it } from "vitest";
import { boundArg, narrowest } from "./commands";

describe("reading a window off two arguments", () => {
  it("is nothing at all when neither is given — the ordinary `clip trim x -40`", () => {
    expect(boundArg(undefined, undefined)).toBeNull();
  });

  it("is the pair when both are numbers", () => {
    expect(boundArg("1.5", "4.25")).toEqual({ from: 1.5, to: 4.25 });
  });

  it("refuses a pair that is not a window, rather than guessing at one", () => {
    // Each of these would otherwise become a window of zero or negative length, which plays
    // nothing at all — and a trim that keeps nothing is worse than a trim that is refused.
    expect(boundArg("2", undefined)).toBe("bad");
    expect(boundArg("2", "2")).toBe("bad");
    expect(boundArg("4", "1")).toBe("bad");
    expect(boundArg("-1", "3")).toBe("bad");
    expect(boundArg("early", "late")).toBe("bad");
  });
});

describe("the more restrictive of two windows", () => {
  it("intersects them — the rule `event resize` already draws", () => {
    expect(narrowest({ from: 1, to: 5 }, { from: 2, to: 9 })).toEqual({
      from: 2,
      to: 5,
    });
  });

  it("cannot WIDEN a clip's window, which is the whole point of the intersection", () => {
    // A re-trim refines what the clip plays and never reaches back into material an earlier trim
    // removed — undo is how that comes back, deliberately.
    expect(narrowest({ from: 2, to: 4 }, { from: 0, to: 10 })).toEqual({
      from: 2,
      to: 4,
    });
  });

  it("takes whichever exists when only one does", () => {
    // `null` is "states none": a clip with no from/to at all, or a caller naming no bound.
    expect(narrowest(null, { from: 1, to: 2 })).toEqual({ from: 1, to: 2 });
    expect(narrowest({ from: 1, to: 2 }, null)).toEqual({ from: 1, to: 2 });
    expect(narrowest(null, null)).toBeNull();
  });

  it("keeps the CLIP's window when the two do not meet", () => {
    // A caller asking about material this clip does not play. Answering the empty intersection
    // would trim to nothing and say nothing; the clip's own window is the honest answer.
    expect(narrowest({ from: 0, to: 2 }, { from: 5, to: 9 })).toEqual({
      from: 0,
      to: 2,
    });
  });
});
