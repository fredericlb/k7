// A placement's `animate:` reaches the picture document as sorted keys per property — the one
// shape the renderer reads — and a malformed one is left to the schema rather than half-read.

import { describe, expect, it } from "vitest";
import { readAnimate, videoPlacementToClip } from "./videoTracks";

describe("readAnimate", () => {
  it("normalises constants, pairs and maps into sorted keys", () => {
    expect(
      readAnimate({
        x: [
          [4, 100],
          [0, 0],
        ],
        opacity: 0.5,
        scale: [{ t: 1, v: 2, ease: "out" }],
      }),
    ).toEqual({
      x: [
        { t: 0, v: 0, ease: "linear" },
        { t: 4, v: 100, ease: "linear" },
      ],
      scale: [{ t: 1, v: 2, ease: "out" }],
      opacity: [{ t: 0, v: 0.5, ease: "linear" }],
    });
  });

  it("answers nothing for no animation and for a malformed one", () => {
    expect(readAnimate(undefined)).toBeUndefined();
    expect(readAnimate({ wobble: 1 })).toBeUndefined();
  });
});

describe("a placement's animation in the picture document", () => {
  it("is carried on a shot and on an activation alike", () => {
    const clips = { a: { source: "clips/a.mp4" } };
    const shot = videoPlacementToClip(
      "/p",
      { ref: "a", start: 2, length: 4, animate: { rotate: 15 } },
      clips,
    );
    const on = videoPlacementToClip(
      "/p",
      {
        start: 0,
        length: 4,
        animate: {
          y: [
            [0, -50],
            [1, 0],
          ],
        },
      },
      clips,
    );
    expect(shot.animate).toEqual({ rotate: [{ t: 0, v: 15, ease: "linear" }] });
    expect(on.animate?.y).toHaveLength(2);
  });
});
