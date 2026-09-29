// What a layout change means for the cards: which slid, which arrived, which left — and that a
// second change landing mid-slide continues from the screen rather than from a place nothing
// ever reached. See docs/nodeMotion.md.

import { describe, expect, it } from "vitest";
import {
  advanceMotion,
  ENTER_SCALE,
  type Ghost,
  type Motion,
  type MotionNode,
  motionPos,
  motionTransform,
  ORGANIZE_HALF_LIFE,
  planMotion,
} from "./nodeMotion";

const at = (id: string, x: number, y: number): MotionNode => ({ id, x, y });
const drawn = (...nodes: MotionNode[]): Map<string, Ghost<MotionNode>> =>
  new Map(nodes.map((n) => [n.id, { node: n, x: n.x, y: n.y }]));
const NONE = new Map<string, Motion>();

describe("planMotion", () => {
  it("gives a node that moved the offset back to where it was", () => {
    // React has already drawn it at 100; the transform is what still separates it from 40.
    const p = planMotion(drawn(at("a", 40, 0)), NONE, [at("a", 100, 10)]);
    expect(p.moving).toBe(true);
    expect(p.motions.get("a")).toEqual({ dx: -60, dy: -10, a: 1, at: 1 });
    expect(p.ghosts).toEqual([]);
  });

  it("leaves a node that did not move alone — no entry, no inline style", () => {
    const p = planMotion(drawn(at("a", 40, 0)), NONE, [at("a", 40, 0)]);
    expect(p.moving).toBe(false);
    expect(p.motions.size).toBe(0);
  });

  it("treats a sub-pixel difference as a layout rounding, not a movement", () => {
    const p = planMotion(drawn(at("a", 40, 0)), NONE, [at("a", 40.2, -0.1)]);
    expect(p.motions.size).toBe(0);
  });

  it("fades a NEW node up where it belongs rather than sliding it in from nowhere", () => {
    const p = planMotion(drawn(at("a", 0, 0)), NONE, [
      at("a", 0, 0),
      at("b", 9, 9),
    ]);
    expect(p.motions.get("b")).toEqual({ dx: 0, dy: 0, a: 0, at: 1 });
    // The one that did not move stays out of it.
    expect(p.motions.has("a")).toBe(false);
  });

  it("keeps a REMOVED node as a ghost, heading for absent", () => {
    const p = planMotion(drawn(at("a", 0, 0), at("b", 50, 5)), NONE, [
      at("a", 0, 0),
    ]);
    expect(p.ghosts).toEqual([{ node: at("b", 50, 5), x: 50, y: 5 }]);
    expect(p.motions.get("b")).toEqual({ dx: 0, dy: 0, a: 1, at: 0 });
  });

  it("continues from the SCREEN when a layout lands mid-slide", () => {
    // Told 100, still 30 short, now told 200: the offset is measured from 70 and not from 100.
    const flying = new Map<string, Motion>([
      ["a", { dx: -30, dy: 0, a: 1, at: 1 }],
    ]);
    const p = planMotion(drawn(at("a", 100, 0)), flying, [at("a", 200, 0)]);
    expect(p.motions.get("a")?.dx).toBe(-130);
  });

  it("turns a half-gone node around instead of finishing its exit", () => {
    // A replace on the same id is one card: it comes back up from where its fade got to.
    const flying = new Map<string, Motion>([
      ["b", { dx: 0, dy: 0, a: 0.4, at: 0 }],
    ]);
    const p = planMotion(drawn(at("b", 50, 5)), flying, [at("b", 50, 5)]);
    expect(p.motions.get("b")).toEqual({ dx: 0, dy: 0, a: 0.4, at: 1 });
    expect(p.ghosts).toEqual([]);
  });

  it("fades a card up in place rather than flying it across the view", () => {
    // The mixer view is the case: past the cap a card simply appears — docs/nodeMotion.md.
    const p = planMotion(drawn(at("a", 0, 0)), NONE, [at("a", 4000, 0)], 500);
    expect(p.motions.get("a")).toEqual({ dx: 0, dy: 0, a: 0, at: 1 });
    // …and just under it, it still travels.
    const near = planMotion(drawn(at("a", 0, 0)), NONE, [at("a", 400, 0)], 500);
    expect(near.motions.get("a")?.dx).toBe(-400);
  });

  it("starts a ghost's exit from where it had got to", () => {
    const flying = new Map<string, Motion>([
      ["b", { dx: -20, dy: 4, a: 1, at: 1 }],
    ]);
    const p = planMotion(drawn(at("b", 50, 0)), flying, []);
    expect(p.ghosts[0]).toEqual({ node: at("b", 50, 0), x: 30, y: 4 });
  });
});

describe("advanceMotion", () => {
  const one = (m: Motion) => new Map<string, Motion>([["a", { ...m }]]);

  it("is frame-rate independent: two 8 ms frames leave what one 16 ms frame leaves", () => {
    // The same rule the zoom glide already follows, in camera.ts's `approach`.
    const fast = one({ dx: 100, dy: 0, a: 1, at: 1 });
    advanceMotion(fast, 8);
    advanceMotion(fast, 8);
    const slow = one({ dx: 100, dy: 0, a: 1, at: 1 });
    advanceMotion(slow, 16);
    expect(fast.get("a")?.dx).toBeCloseTo(slow.get("a")?.dx ?? 0, 10);
  });

  it("advances nothing at dt 0 — the first write only PLACES the offset", () => {
    const m = one({ dx: 100, dy: -40, a: 0, at: 1 });
    expect(advanceMotion(m, 0)).toBe(true);
    expect(m.get("a")).toEqual({ dx: 100, dy: -40, a: 0, at: 1 });
  });

  it("lands an arrival and DROPS it, so its style is cleared exactly once", () => {
    const m = one({ dx: 0.2, dy: 0, a: 0.999, at: 1 });
    expect(advanceMotion(m, 16)).toBe(false);
    expect(m.size).toBe(0);
  });

  it("keeps a finished EXIT, since its card is still mounted", () => {
    const m = one({ dx: 0, dy: 0, a: 0.001, at: 0 });
    expect(advanceMotion(m, 16)).toBe(false);
    expect(m.get("a")).toEqual({ dx: 0, dy: 0, a: 0, at: 0 });
  });

  it("gets most of the way there in a couple of hundred ms", () => {
    // The feel, pinned: a slide anyone waits on is a slide nobody wants.
    const m = one({ dx: 400, dy: 0, a: 1, at: 1 });
    for (let t = 0; t < 200; t += 16) advanceMotion(m, 16);
    expect(Math.abs(m.get("a")?.dx ?? 400)).toBeLessThan(400 * 0.15);
  });
});

describe("what the frame writes", () => {
  it("carries the offset and how present the card is, in one transform", () => {
    expect(motionTransform({ dx: -12, dy: 3, a: 1, at: 1 })).toBe(
      "translate(-12px, 3px) scale(1)",
    );
    expect(motionTransform({ dx: 0, dy: 0, a: 0, at: 1 })).toBe(
      `translate(0px, 0px) scale(${ENTER_SCALE})`,
    );
  });

  it("tells a cable where its node IS, not where it is going", () => {
    const ms = new Map<string, Motion>([
      ["a", { dx: -60, dy: -10, a: 1, at: 1 }],
    ]);
    expect(motionPos(at("a", 100, 10), ms)).toEqual({ x: 40, y: 0 });
    // A node with nothing in flight answers its own position, and allocates the same shape.
    expect(motionPos(at("b", 7, 8), ms)).toEqual({ x: 7, y: 8 });
  });
});

describe("an organize is watched", () => {
  it("slides a card however far it goes, rather than fading it up in place", () => {
    const plan = planMotion(
      drawn(at("a", 0, 0)),
      NONE,
      [at("a", 5000, 0)],
      Number.POSITIVE_INFINITY,
      ORGANIZE_HALF_LIFE,
    );
    expect(plan.motions.get("a")).toMatchObject({
      dx: -5000,
      a: 1,
      half: ORGANIZE_HALF_LIFE,
    });
  });

  it("travels slower than an edit's move, over the same time", () => {
    const quick = planMotion(drawn(at("a", 0, 0)), NONE, [
      at("a", 100, 0),
    ]).motions;
    const slow = planMotion(
      drawn(at("a", 0, 0)),
      NONE,
      [at("a", 100, 0)],
      undefined,
      ORGANIZE_HALF_LIFE,
    ).motions;
    advanceMotion(quick, 100);
    advanceMotion(slow, 100);
    expect(Math.abs(slow.get("a")?.dx ?? 0)).toBeGreaterThan(
      Math.abs(quick.get("a")?.dx ?? 0),
    );
  });

  it("keeps its pace when the command's reload lands mid-slide", () => {
    const first = planMotion(
      drawn(at("a", 0, 0)),
      NONE,
      [at("a", 100, 0)],
      undefined,
      ORGANIZE_HALF_LIFE,
    );
    advanceMotion(first.motions, 50);
    const again = planMotion(drawn(at("a", 100, 0)), first.motions, [
      at("a", 100, 0),
    ]);
    expect(again.motions.get("a")?.half).toBe(ORGANIZE_HALF_LIFE);
  });
});
