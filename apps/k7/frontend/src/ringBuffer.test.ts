import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ringBuffer";

describe("RingBuffer", () => {
  it("keeps values in push order below capacity", () => {
    const r = new RingBuffer(4);
    r.push(1);
    r.push(2);
    expect(r.length).toBe(2);
    expect(r.toArray()).toEqual([1, 2]);
  });

  it("drops the oldest once full, as shift() did", () => {
    const r = new RingBuffer(3);
    for (const v of [1, 2, 3, 4, 5]) r.push(v);
    expect(r.length).toBe(3);
    expect(r.toArray()).toEqual([3, 4, 5]);
  });

  it("matches an array trimmed with shift() over many wraps", () => {
    const r = new RingBuffer(7);
    const ref: number[] = [];
    for (let i = 0; i < 100; i++) {
      r.push(i * 0.5);
      ref.push(i * 0.5);
      if (ref.length > 7) ref.shift();
      expect(r.toArray()).toEqual(ref);
    }
  });

  it("starts over on clear", () => {
    const r = new RingBuffer(2);
    r.push(1);
    r.push(2);
    r.push(3);
    r.clear();
    expect(r.length).toBe(0);
    r.push(9);
    expect(r.toArray()).toEqual([9]);
  });

  it("hands out a fresh array per read", () => {
    const r = new RingBuffer(2);
    r.push(1);
    expect(r.toArray()).not.toBe(r.toArray());
  });
});
