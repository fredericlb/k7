// A block of text laid out: what would go wrong silently is a written line break lost, a long
// word broken mid-word or dropped, a centred line measured against the wrong width, and a caption
// anchored on its top when it was asked to sit on its bottom.

import { describe, expect, it } from "vitest";
import { cueAt } from "./captionFrames";
import { layoutText, wrapLines } from "./text";

// Ten px a character: easy to reason about, and enough to drive every wrapping decision.
const measure = (s: string) => s.length * 10;

describe("wrapLines", () => {
  it("keeps written breaks and wraps words inside the width", () => {
    expect(wrapLines("one two three\nfour", 80, measure)).toEqual([
      "one two",
      "three",
      "four",
    ]);
  });

  it("leaves a word wider than the width on a line of its own", () => {
    expect(wrapLines("a extraordinary b", 50, measure)).toEqual([
      "a",
      "extraordinary",
      "b",
    ]);
  });

  it("does not wrap with no width", () => {
    expect(wrapLines("a long line indeed", undefined, measure)).toEqual([
      "a long line indeed",
    ]);
  });
});

describe("layoutText", () => {
  const block = {
    content: "ab\nabcd",
    font: "sans-serif",
    fontSize: 10,
    color: "#fff",
    x: 100,
    y: 50,
  };

  it("centres each line inside the width", () => {
    const { lines } = layoutText(
      { ...block, w: 100, align: "center" },
      measure,
    );
    expect(lines.map((l) => l.x)).toEqual([140, 130]);
  });

  it("hangs a centred block on x when there is no width", () => {
    const { lines } = layoutText({ ...block, align: "center" }, measure);
    expect(lines.map((l) => l.x)).toEqual([90, 80]);
  });

  it("sits a bottom-anchored block ON y, and boxes the lines with their padding", () => {
    const { top, box } = layoutText(
      { ...block, anchor: "bottom", background: "#000", padding: 5 },
      measure,
    );
    // Two lines at 1.2 × 10 px: 24 px tall, so the top is 24 above y.
    expect(top).toBeCloseTo(26, 9);
    expect(box).toEqual([95, top - 5, 50, 34]);
  });
});

describe("cueAt", () => {
  const captions = {
    cues: [
      { start: 1, end: 2, text: "a" },
      { start: 3, end: 4, text: "b" },
    ],
    style: {},
  };

  it("finds the cue showing, and none between cues", () => {
    expect(cueAt(captions, 1.5)).toBe(0);
    expect(cueAt(captions, 2.5)).toBe(-1);
    expect(cueAt(captions, 3)).toBe(1);
    expect(cueAt(captions, 4)).toBe(-1);
  });
});
