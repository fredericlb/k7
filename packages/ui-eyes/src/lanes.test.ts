// Which <video> elements a new scene keeps: the pure plan behind RealtimeDriver.setScene.

import { describe, expect, it } from "vitest";
import { elementCount, planReuse } from "./lanes";
import type { VideoLayer } from "./scene";

describe("planReuse", () => {
  it("keeps every element when the edit leaves the shots where they were", () => {
    const plan = planReuse(
      [
        { layer: "a", src: "a.mp4" },
        { layer: "b", src: "b.mp4" },
      ],
      [
        { layer: "a", srcs: ["a.mp4"], count: 1 },
        { layer: "b", srcs: ["b.mp4"], count: 1 },
      ],
    );
    expect(plan).toEqual({ lanes: [[0], [1]], drop: [] });
  });

  it("follows a src to the lane that now plays it, before reusing by layer", () => {
    const plan = planReuse(
      [
        { layer: "a", src: "x.mp4" },
        { layer: "b", src: "y.mp4" },
      ],
      [
        { layer: "a", srcs: ["y.mp4"], count: 1 },
        { layer: "b", srcs: ["x.mp4"], count: 1 },
      ],
    );
    expect(plan.lanes).toEqual([[1], [0]]);
  });

  it("makes only the added elements and drops only the removed ones", () => {
    const plan = planReuse(
      [
        { layer: "a", src: "a.mp4" },
        { layer: "gone", src: "g.mp4" },
      ],
      [
        { layer: "a", srcs: ["a.mp4"], count: 2 },
        { layer: "shapes", srcs: [], count: 0 },
      ],
    );
    // The leftover element is cheaper re-pointed than released and made again.
    expect(plan).toEqual({ lanes: [[0, 1], []], drop: [] });
    const fewer = planReuse(
      [
        { layer: "a", src: "a.mp4" },
        { layer: "gone", src: "g.mp4" },
      ],
      [{ layer: "a", srcs: ["a.mp4"], count: 1 }],
    );
    expect(fewer).toEqual({ lanes: [[0]], drop: [1] });
    const more = planReuse([], [{ layer: "a", srcs: ["a.mp4"], count: 2 }]);
    expect(more).toEqual({ lanes: [[-1, -1]], drop: [] });
  });

  it("keeps a dissolving pair on their own elements", () => {
    const plan = planReuse(
      [
        { layer: "a", src: "b.mp4" },
        { layer: "a", src: "a.mp4" },
      ],
      [{ layer: "a", srcs: ["a.mp4", "b.mp4"], count: 2 }],
    );
    expect(plan.lanes).toEqual([[0, 1]]);
  });

  it("never hands one element to two lanes", () => {
    const plan = planReuse(
      [{ layer: "a", src: "s.mp4" }],
      [
        { layer: "a", srcs: ["s.mp4"], count: 1 },
        { layer: "b", srcs: ["s.mp4"], count: 1 },
      ],
    );
    expect(plan.lanes).toEqual([[0], [-1]]);
  });
});

describe("elementCount", () => {
  const layer = (over: Partial<VideoLayer>): VideoLayer =>
    ({ id: "l", clips: [], ...over }) as VideoLayer;

  it("is none for a camera or shapes, two where a fade_in dissolves, else one", () => {
    expect(elementCount(layer({ camera: "" }))).toBe(0);
    expect(elementCount(layer({ shapes: [{}] as VideoLayer["shapes"] }))).toBe(
      0,
    );
    expect(
      elementCount(
        layer({ clips: [{ fadeIn: {} }] as unknown as VideoLayer["clips"] }),
      ),
    ).toBe(2);
    expect(elementCount(layer({}))).toBe(1);
  });
});
