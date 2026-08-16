// The two gestures that draw a cable, and the failure that made this file exist: the graph only
// ever answered click-then-click, so a DRAG out of a socket connected nothing — and worse, the
// press armed a canvas pan, so the graph slid sideways under the cable being drawn.
//
// The signature to guard: `patchAct("down", …)` must answer "arm". Everything a drag needs
// follows from the cable existing before the button comes back up.

import { describe, expect, it } from "vitest";
import { patchAct } from "./patchGesture";

const OUT = "gtr#out";
const IN = "reverb#in";

describe("press-drag-release", () => {
  it("arms on the PRESS — the failure this fixes was arming on the click", () => {
    expect(patchAct("down", false, null, OUT)).toBe("arm");
  });

  it("lands when the release is over another socket", () => {
    expect(patchAct("up", true, OUT, IN)).toBe("land");
  });
});

describe("click, then click", () => {
  it("the release that ENDS the arming press lands nothing", () => {
    // Same socket, so the gesture is a click: the cable stays in hand for a second one.
    expect(patchAct("up", true, OUT, OUT)).toBe("nothing");
  });

  it("…and the second click's press lands it", () => {
    expect(patchAct("down", true, null, IN)).toBe("land");
  });
});

describe("what neither gesture may do", () => {
  it("never lands a cable that is not in hand", () => {
    expect(patchAct("up", false, null, IN)).toBe("nothing");
    expect(patchAct("up", false, OUT, IN)).toBe("nothing");
  });

  it("never arms on a release — only a press starts a cable", () => {
    expect(patchAct("up", false, null, OUT)).not.toBe("arm");
  });
});
