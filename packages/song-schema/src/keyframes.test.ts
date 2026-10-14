// A shot's animation: what would go wrong silently is a value invented outside the keys, an ease
// read off the wrong end of its segment, and a split whose tail no longer plays what the shot did.

import { describe, expect, it } from "vitest";
import {
  AnimateSchema,
  keysOf,
  splitAnimate,
  transformAt,
  valueAt,
} from "./keyframes";

describe("valueAt", () => {
  const keys = keysOf([[1, 0], { t: 3, v: 100, ease: "hold" }, [5, 200]]);

  it("holds the first value before it and the last after it", () => {
    expect(valueAt(keys, 0)).toBe(0);
    expect(valueAt(keys, 9)).toBe(200);
  });

  it("is linear between two linear keys", () => {
    expect(valueAt(keys, 2)).toBe(50);
  });

  it("reads the ease off the key the segment LEAVES", () => {
    // 3 → 5 leaves a `hold` key, so it stays at 100 until 5.
    expect(valueAt(keys, 4.9)).toBe(100);
    expect(valueAt(keys, 5)).toBe(200);
  });

  it("sorts keys written out of order", () => {
    expect(
      valueAt(
        keysOf([
          [2, 10],
          [0, 0],
        ]),
        1,
      ),
    ).toBe(5);
  });
});

describe("transformAt", () => {
  it("leaves every property it is not told about at rest", () => {
    expect(
      transformAt(
        {
          opacity: [
            [0, 0],
            [1, 1],
          ],
        },
        0.5,
      ),
    ).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      opacity: 0.5,
      rotate: 0,
    });
    expect(transformAt(undefined, 3).scale).toBe(1);
  });
});

describe("splitAnimate", () => {
  const animate = {
    x: [[0, 0], { t: 4, v: 400, ease: "inout" as const }, [8, 0]] as const,
    scale: 1.2,
  };

  it("keeps a constant on both halves", () => {
    const { head, tail } = splitAnimate(animate as never, 5, 8);
    expect(head.scale).toBe(1.2);
    expect(tail.scale).toBe(1.2);
  });

  it("cuts exactly: each half plays what the shot played over its span", () => {
    const { head, tail } = splitAnimate(animate as never, 5, 8);
    for (const t of [0, 1, 2.5, 4, 4.99])
      expect(transformAt(head, t).x).toBeCloseTo(
        transformAt(animate as never, t).x,
        9,
      );
    for (const t of [0, 0.5, 1.5, 3])
      expect(transformAt(tail, t).x).toBeCloseTo(
        transformAt(animate as never, t + 5).x,
        9,
      );
  });

  it("keeps only the keys that still shape each half", () => {
    const { head, tail } = splitAnimate(animate as never, 5, 8);
    // The head needs the key at 8 to know where 4 → 8 was heading; the tail needs the one at 4.
    expect(head.x).toEqual([[0, 0], { t: 4, v: 400, ease: "inout" }, [8, 0]]);
    expect(tail.x).toEqual([{ t: -1, v: 400, ease: "inout" }, [3, 0]]);
  });
});

describe("AnimateSchema", () => {
  it("names a property it does not know rather than ignoring it", () => {
    const r = AnimateSchema.safeParse({ opactiy: 1 });
    expect(r.success).toBe(false);
  });

  it("takes pairs, maps and constants", () => {
    expect(
      AnimateSchema.safeParse({
        x: [[0, 0], { t: 1, v: 5, ease: "out" }],
        opacity: 0.5,
      }).success,
    ).toBe(true);
  });
});
