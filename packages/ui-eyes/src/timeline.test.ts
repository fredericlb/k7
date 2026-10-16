// The one place the transition rule lives, asserted without any GL: which clips are active, which
// covers which, and the four shapes a frame takes. See song-video/docs/transitions.md.

import { describe, expect, it } from "vitest";
import type { SceneClip, SceneFade, VideoLayer } from "./scene";
import { activeAt, activesAt, layerFrameAt, shapesVisibleAt } from "./timeline";

const clip = (
  start: number,
  length: number,
  id = `c${start}`,
  fades: { fadeIn?: SceneFade; fadeOut?: SceneFade } = {},
): SceneClip => ({
  id,
  src: `${id}.mp4`,
  start,
  length,
  sourceFrom: 0,
  ...fades,
});

const layer = (clips: SceneClip[]): VideoLayer => ({
  id: "cam",
  hidden: false,
  x: 0,
  y: 0,
  w: 1920,
  h: 1080,
  clips,
});

const dissolve = (over: number): SceneFade => ({ over, with: "dissolve" });

describe("activesAt", () => {
  it("is empty before, between and after", () => {
    const l = layer([clip(2, 2), clip(6, 2)]);
    for (const t of [0, 1.9, 4, 5.9, 8, 99])
      expect(activesAt(l, t)).toHaveLength(0);
  });

  it("gives BOTH clips inside an overlap, in file order", () => {
    const l = layer([clip(0, 5), clip(4, 5)]);
    expect(activesAt(l, 4.5).map((a) => a.clip.id)).toEqual(["c0", "c4"]);
  });

  it("keeps the top TWO when three overlap — a lane has two decoders", () => {
    const l = layer([clip(0, 9), clip(1, 9), clip(2, 9)]);
    expect(activesAt(l, 5).map((a) => a.clip.id)).toEqual(["c1", "c2"]);
  });

  it("runs a length-0 shot to the NEXT start, and the last one for ever", () => {
    const l = layer([clip(0, 0), clip(4, 0)]);
    expect(activesAt(l, 3.9).map((a) => a.clip.id)).toEqual(["c0"]);
    expect(activesAt(l, 1e6).map((a) => a.clip.id)).toEqual(["c4"]);
  });

  it("maps into the source by sourceFrom + elapsed", () => {
    const l = layer([{ ...clip(4, 4), sourceFrom: 2.5 }]);
    expect(activesAt(l, 5)[0].sourceTime).toBe(3.5);
  });
});

describe("activeAt picks the LAST active, not the first", () => {
  // The first would make a completed dissolve snap back to the outgoing shot for its last frames.
  it("returns the incoming shot inside an overlap", () => {
    const l = layer([clip(0, 5), clip(4, 5)]);
    expect(activeAt(l, 4.5)?.clip.id).toBe("c4");
    expect(activeAt(l, 4.99)?.clip.id).toBe("c4");
  });

  it("is null on an empty lane and in a gap", () => {
    expect(activeAt(layer([]), 0)).toBeNull();
    expect(activeAt(layer([clip(0, 1), clip(4, 1)]), 2)).toBeNull();
  });
});

describe("layerFrameAt", () => {
  it("is a plain cut when nothing fades", () => {
    const f = layerFrameAt(layer([clip(0, 4)]), 1);
    expect(f.blend).toBeNull();
    expect(f.to?.clip.id).toBe("c0");
    expect(f.from).toBeNull();
  });

  it("blends the incoming shot OVER the outgoing one, 0 to 1", () => {
    const l = layer([clip(0, 5), clip(4, 5, "c4", { fadeIn: dissolve(1) })]);
    expect(layerFrameAt(l, 4).blend?.progress).toBe(0);
    expect(layerFrameAt(l, 4.5).blend?.progress).toBeCloseTo(0.5);
    const mid = layerFrameAt(l, 4.5);
    expect(mid.from?.clip.id).toBe("c0");
    expect(mid.to?.clip.id).toBe("c4");
  });

  it("draws the incoming shot alone once the window is over — no snap back", () => {
    // The outgoing shot OUTLASTS the fade: picking the first active here would blit c0 again,
    // so the dissolve would finish and the picture would jump back for the remaining second.
    const l = layer([clip(0, 6), clip(4, 5, "c4", { fadeIn: dissolve(1) })]);
    expect(layerFrameAt(l, 4.9).blend).not.toBeNull();
    const f = layerFrameAt(l, 5.5);
    expect(f.blend).toBeNull();
    expect(f.to?.clip.id).toBe("c4");
  });

  it("fades in from NOTHING when no shot is underneath — the same branch", () => {
    const l = layer([clip(0, 5, "c0", { fadeIn: dissolve(2) })]);
    const f = layerFrameAt(l, 1);
    expect(f.from).toBeNull();
    expect(f.to?.clip.id).toBe("c0");
    expect(f.blend?.progress).toBeCloseTo(0.5);
  });

  it("fades out toward nothing, over the shot's own end", () => {
    const l = layer([clip(0, 4, "c0", { fadeOut: dissolve(2) })]);
    expect(layerFrameAt(l, 1).blend).toBeNull();
    const f = layerFrameAt(l, 3);
    expect(f.from?.clip.id).toBe("c0");
    expect(f.to).toBeNull();
    expect(f.blend?.progress).toBeCloseTo(0.5);
  });

  it("anchors a length-0 shot's fade_out on the NEXT shot's start", () => {
    const l = layer([clip(0, 0, "c0", { fadeOut: dissolve(2) }), clip(8, 2)]);
    expect(layerFrameAt(l, 7).blend?.progress).toBeCloseTo(0.5);
  });

  it("runs no fade_out on an OPEN-ended shot — there is no end to measure back from", () => {
    const l = layer([clip(0, 0, "c0", { fadeOut: dissolve(2) })]);
    expect(layerFrameAt(l, 1e6).blend).toBeNull();
  });

  it("clamps a fade longer than the shot rather than refusing it", () => {
    // A trim can outrun the fade mid-drag, and a frame that refuses to draw is worse than a fast one.
    const l = layer([clip(0, 1, "c0", { fadeIn: dissolve(10) })]);
    expect(layerFrameAt(l, 0).blend?.progress).toBe(0);
    expect(layerFrameAt(l, 0.5).blend?.progress).toBeCloseTo(0.5);
    expect(layerFrameAt(l, 0.99).blend?.progress).toBeLessThan(1);
  });

  it("carries the NAMED kind through, so the renderer knows which program to run", () => {
    const l = layer([clip(0, 4, "c0", { fadeIn: { over: 1, with: "wipe" } })]);
    expect(layerFrameAt(l, 0.5).blend?.name).toBe("wipe");
  });

  it("lets fade_in win over fade_out when a shot is short enough to run both", () => {
    // Two programs cannot run on one pair; the incoming edge owns the cut.
    const l = layer([
      clip(0, 2, "c0", { fadeIn: dissolve(2), fadeOut: dissolve(2) }),
    ]);
    expect(layerFrameAt(l, 1.5).to?.clip.id).toBe("c0");
    expect(layerFrameAt(l, 1.5).from).toBeNull();
  });

  it("shows nothing on an empty lane", () => {
    expect(layerFrameAt(layer([]), 0)).toEqual({
      from: null,
      to: null,
      blend: null,
    });
  });
});

describe("a fade's STRETCH", () => {
  const over = (chain: string, s = 1): SceneFade => ({
    over: s,
    with: "over",
    chain,
  });

  it("runs the incoming shot through it, its presence rising 0 to 1", () => {
    const l = layer([clip(0, 4), clip(3, 4, "c3", { fadeIn: over("iris") })]);
    expect(layerFrameAt(l, 3.25).blend).toEqual({
      name: "over",
      progress: 0.25,
      stretch: { to: { chain: "iris", presence: 0.25 } },
    });
  });

  it("runs the leaving shot through ITS fade-out's, presence falling 1 to 0", () => {
    const l = layer([clip(0, 4, "c0", { fadeOut: over("zoom", 2) })]);
    expect(layerFrameAt(l, 3.5).blend?.stretch).toEqual({
      from: { chain: "zoom", presence: 0.25 },
    });
  });

  it("runs BOTH under an overlap: the incoming blends, the outgoing still leaves its own way", () => {
    const l = layer([
      clip(0, 4, "c0", { fadeOut: over("zoom") }),
      clip(3, 4, "c3", { fadeIn: over("iris") }),
    ]);
    expect(layerFrameAt(l, 3.5).blend?.stretch).toEqual({
      from: { chain: "zoom", presence: 0.5 },
      to: { chain: "iris", presence: 0.5 },
    });
  });

  it("leaves the outgoing shot alone before its own fade-out window opens", () => {
    const l = layer([
      clip(0, 4, "c0", { fadeOut: over("zoom", 0.5) }),
      clip(3, 4, "c3", { fadeIn: over("iris") }),
    ]);
    expect(layerFrameAt(l, 3.25).blend?.stretch).toEqual({
      to: { chain: "iris", presence: 0.25 },
    });
  });

  it("carries no stretch at all on a plain dissolve — the ordinary case stays as it was", () => {
    const l = layer([clip(0, 4), clip(3, 4, "c3", { fadeIn: dissolve(1) })]);
    expect(layerFrameAt(l, 3.5).blend).toEqual({
      name: "dissolve",
      progress: 0.5,
    });
  });
});

describe("a layer of SHAPES, whose clips are ACTIVATION spans", () => {
  // An activation carries no picture, so it has no src and no in-point — only when the lane is on.
  const on = (start: number, length: number): SceneClip => ({
    id: "",
    src: "",
    start,
    length,
    sourceFrom: 0,
  });

  it("is on throughout when it states no span at all", () => {
    const l = { ...layer([]), shapes: [] };
    for (const t of [0, 5, 1e6]) expect(shapesVisibleAt(l, t)).toBe(true);
  });

  it("is on only inside the spans it states, by the interval rule the clips use", () => {
    const l = layer([on(2, 2), on(6, 2)]);
    expect([0, 1.9, 4, 5.9, 8, 99].map((t) => shapesVisibleAt(l, t))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect([2, 3.9, 6, 7.9].map((t) => shapesVisibleAt(l, t))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("runs a length-0 span to the next one, and the LAST one forever", () => {
    const l = layer([on(0, 0), on(4, 0)]);
    expect(shapesVisibleAt(l, 3.9)).toBe(true);
    expect(shapesVisibleAt(l, 1e6)).toBe(true);
  });
});
