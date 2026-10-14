// A split is two placements of one clip, and must play exactly as the one did: what would go wrong
// silently is a tail appended at the end of the file (where it covers the wrong shots), a tail
// that restarts its source, and a fade left on the wrong side of the cut.

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
  listVideoPlacements,
  shiftVideoAnimationAt,
  splitVideoPlacementAt,
} from "./videoTrackFile";

const events = (text: string) =>
  parseDocument(text).toJSON().events as Record<string, unknown>[];

const LANE = `# the A-roll
events:
  - { ref: a, start: 2, length: 6, source_from: 1, fade_in: 0.5, fade_out: { over: 1, with: wipe } }
  - { ref: b, start: 10, length: 0 }
`;

describe("splitVideoPlacementAt", () => {
  it("cuts a shot into a head and a tail that play the same frames, the tail right after the head", () => {
    const out = splitVideoPlacementAt(LANE, 0, 5) as string;
    expect(events(out)).toEqual([
      { ref: "a", start: 2, length: 3, source_from: 1, fade_in: 0.5 },
      {
        ref: "a",
        start: 5,
        length: 3,
        source_from: 4,
        fade_out: { over: 1, with: "wipe" },
      },
      { ref: "b", start: 10, length: 0 },
    ]);
    expect(out).toContain("# the A-roll");
  });

  it("keeps a length-0 tail open, running to the next start as the shot did", () => {
    const out = splitVideoPlacementAt(LANE, 1, 12) as string;
    expect(listVideoPlacements(out).slice(1)).toEqual([
      { ref: "b", start: 10, length: 2, sourceFrom: 0 },
      { ref: "b", start: 12, length: 0, sourceFrom: 2 },
    ]);
  });

  it("splits an activation without inventing a source to trim", () => {
    const out = splitVideoPlacementAt(
      "events:\n  - { start: 0, length: 4 }\n",
      0,
      1,
    ) as string;
    expect(events(out)).toEqual([
      { start: 0, length: 1 },
      { start: 1, length: 3 },
    ]);
  });

  it("cuts the animation exactly, each half playing what the shot did", () => {
    const text = `events:
  - { ref: a, start: 0, length: 8, animate: { x: [[0, 0], [8, 800]], opacity: 0.5 } }
`;
    const out = events(splitVideoPlacementAt(text, 0, 2) as string);
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

  it("refuses a cut on an edge or outside the shot", () => {
    expect(splitVideoPlacementAt(LANE, 0, 2)).toBeNull();
    expect(splitVideoPlacementAt(LANE, 0, 8)).toBeNull();
    expect(splitVideoPlacementAt(LANE, 0, 9)).toBeNull();
    expect(splitVideoPlacementAt(LANE, 5, 3)).toBeNull();
  });
});

describe("shiftVideoAnimationAt", () => {
  it("moves the keys back by a trimmed head, so they stay on the same frames", () => {
    const text = `events:
  - { ref: a, start: 0, length: 8, animate: { scale: [[0, 1], { t: 4, v: 2, ease: out }], x: 10 } }
`;
    expect(events(shiftVideoAnimationAt(text, 0, 1.5))[0]?.animate).toEqual({
      scale: [[-1.5, 1], { t: 2.5, v: 2, ease: "out" }],
      x: 10,
    });
  });

  it("leaves a shot with no animation untouched", () => {
    expect(shiftVideoAnimationAt(LANE, 0, 1)).toBe(LANE);
  });
});
