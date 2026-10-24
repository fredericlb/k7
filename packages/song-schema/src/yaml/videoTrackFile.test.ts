// A split is two placements of one clip, and must play exactly as the one did: what would go wrong
// silently is a tail appended at the end of the file (where it covers the wrong shots), a tail
// that restarts its source, and a fade left on the wrong side of the cut.

import { K7Document, type K7Scope, parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  addVideoPlacement,
  listVideoPlacements,
  renameFadeChains,
  setVideoLaneRect,
  shiftVideoAnimationAt,
  splitVideoPlacementAt,
} from "./videoTrackFile";

const edit = <R>(text: string, fn: (doc: K7Scope) => R) => {
  const doc = new K7Document(text);
  return { result: fn(doc.at([])), text: doc.toString() };
};

const events = (text: string) =>
  parse(text).events as Record<string, unknown>[];

const LANE = `// the A-roll
extends("@meta/picture-track")
events([
  ref("a").start(2).length(6).from(1).fadeIn(0.5).fadeOut({ over: 1, with: "wipe" }),
  ref("b").start(10).length(0),
])
`;

const split = (text: string, index: number, cut: number) =>
  edit(text, (d) => splitVideoPlacementAt(d, index, cut));

describe("splitVideoPlacementAt", () => {
  it("cuts a shot into a head and a tail that play the same frames, the tail right after the head", () => {
    const out = split(LANE, 0, 5);
    expect(out.result).toBe(true);
    expect(events(out.text)).toEqual([
      { ref: "a", start: 2, length: 3, from: 1, fadeIn: 0.5 },
      {
        ref: "a",
        start: 5,
        length: 3,
        from: 4,
        fadeOut: { over: 1, with: "wipe" },
      },
      { ref: "b", start: 10, length: 0 },
    ]);
    expect(out.text).toContain("// the A-roll");
  });

  it("keeps a length-0 tail open, running to the next start as the shot did", () => {
    expect(listVideoPlacements(split(LANE, 1, 12).text).slice(1)).toEqual([
      { ref: "b", start: 10, length: 2, sourceFrom: 0 },
      { ref: "b", start: 12, length: 0, sourceFrom: 2 },
    ]);
  });

  it("splits an activation without inventing a source to trim", () => {
    const out = split("events([start(0).length(4)])\n", 0, 1);
    expect(events(out.text)).toEqual([
      { start: 0, length: 1 },
      { start: 1, length: 3 },
    ]);
  });

  it("cuts the animation exactly, each half playing what the shot did", () => {
    const text = `events([
  ref("a").start(0).length(8).animate({ x: [[0, 0], [8, 800]], opacity: 0.5 }),
])
`;
    const out = events(split(text, 0, 2).text);
    expect(out[0]?.animate).toEqual({
      x: [
        [0, 0],
        [8, 800],
      ],
      opacity: 0.5,
    });
    // The tail starts 2 s in, so its keys are the same keys two seconds earlier.
    expect(out[1]?.animate).toEqual({
      x: [
        [-2, 0],
        [6, 800],
      ],
      opacity: 0.5,
    });
  });

  it("refuses a cut on an edge or outside the shot, leaving the file alone", () => {
    for (const [i, cut] of [
      [0, 2],
      [0, 8],
      [0, 9],
      [5, 3],
    ])
      expect(split(LANE, i, cut)).toEqual({ result: false, text: LANE });
  });
});

describe("shiftVideoAnimationAt", () => {
  it("moves the keys back by a trimmed head, so they stay on the same frames", () => {
    const text = `events([
  ref("a").start(0).length(8).animate({ scale: [[0, 1], { t: 4, v: 2, ease: "out" }], x: 10 }),
])
`;
    const out = edit(text, (d) => shiftVideoAnimationAt(d, 0, 1.5));
    expect(events(out.text)[0]?.animate).toEqual({
      scale: [[-1.5, 1], { t: 2.5, v: 2, ease: "out" }],
      x: 10,
    });
  });

  it("leaves a shot with no animation untouched", () => {
    expect(edit(LANE, (d) => shiftVideoAnimationAt(d, 0, 1))).toEqual({
      result: false,
      text: LANE,
    });
  });
});

describe("the lane's other edits", () => {
  it("appends a placement on a line of its own, keeping the others", () => {
    const out = edit(LANE, (d) =>
      addVideoPlacement(d, { ref: "c", start: 12, length: 2, sourceFrom: 0 }),
    );
    expect(out.result).toBe(true);
    expect(out.text).toContain('ref("b").start(10).length(0),');
    expect(events(out.text)[2]).toEqual({ ref: "c", start: 12, length: 2 });
  });

  it("creates `events` on an empty lane, and refuses one holding something else", () => {
    const p = { ref: "c", start: 0, length: 1, sourceFrom: 0 };
    const fresh = edit("", (d) => addVideoPlacement(d, p));
    expect(events(fresh.text)).toEqual([{ ref: "c", start: 0, length: 1 }]);
    const odd = 'events("none")\n';
    expect(edit(odd, (d) => addVideoPlacement(d, p))).toEqual({
      result: false,
      text: odd,
    });
  });

  it("renames a fade's chain, and only a fade's", () => {
    const text =
      'events([ref("a").start(0).fadeIn({ over: 1, chain: "iris" })])\n';
    const out = edit(text, (d) => renameFadeChains(d, { iris: "wipe" }));
    expect(out.result).toBe(true);
    expect(out.text).toContain('chain: "wipe"');
    expect(edit(text, (d) => renameFadeChains(d, { x: "y" })).result).toBe(
      false,
    );
  });

  it("writes the lane's rect as `frame`, all four values, rounded to whole pixels", () => {
    const out = edit(LANE, (d) =>
      setVideoLaneRect(d, { x: 10.4, y: 20, w: 320, h: 180.6 }),
    );
    expect(parse(out.text).frame).toEqual([10, 20, 320, 181]);
    expect(out.text).toContain("// the A-roll");
  });

  it("reads nothing from a half-typed buffer, and edits nothing in it", () => {
    const broken = "events([ref(";
    expect(listVideoPlacements(broken)).toEqual([]);
    expect(
      edit(broken, (d) =>
        addVideoPlacement(d, { ref: "a", start: 0, length: 1, sourceFrom: 0 }),
      ),
    ).toEqual({ result: false, text: broken });
  });
});
