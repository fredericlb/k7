import { describe, expect, it } from "vitest";
import { MODE_EXIT, modeCondition, timelineMode } from "./timelineMode";

const sel = { anchor: 1, head: 2 };

describe("timelineMode", () => {
  it("is normal with neither a clip in hand nor a rectangle", () => {
    expect(timelineMode(null, null)).toBe("normal");
  });

  it("is select with a rectangle drawn", () => {
    expect(timelineMode(null, sel)).toBe("select");
  });

  it("is move with a clip in hand", () => {
    expect(timelineMode({}, null)).toBe("move");
  });

  it("lets a move OUTRANK a rectangle: the clip in hand owns the keys", () => {
    expect(timelineMode({}, sel)).toBe("move");
  });

  it("is NOT move once the move is pending — released and written, waiting for the reload", () => {
    expect(timelineMode({ pending: true }, null)).toBe("normal");
    // …and the rectangle underneath it comes back, rather than the pane going deaf for a round trip.
    expect(timelineMode({ pending: true }, sel)).toBe("select");
  });

  it("reads undefined the way it reads null — the caller holds either", () => {
    expect(timelineMode(undefined, undefined)).toBe("normal");
  });
});

describe("modeCondition", () => {
  it("names one condition per mode", () => {
    expect(modeCondition("normal")).toBe("tl_normal");
    expect(modeCondition("select")).toBe("tl_select");
    expect(modeCondition("move")).toBe("tl_move");
  });
});

describe("MODE_EXIT", () => {
  it("names the way out of every mode that has one", () => {
    expect(MODE_EXIT.select).toContain("esc");
    expect(MODE_EXIT.move).toContain("esc");
  });

  it("says nothing for normal, there being nothing to leave", () => {
    expect(MODE_EXIT.normal).toBe("");
  });
});
