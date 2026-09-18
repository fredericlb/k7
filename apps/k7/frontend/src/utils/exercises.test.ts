// A workout is a DRAW, and the two things worth pinning are that it never repeats an exercise
// and that it leaves the book it drew from alone.

import { describe, expect, it } from "vitest";
import { pickWorkout, randomChord } from "./exercises";

const book = ["a", "b", "c", "d", "e"];

describe("pickWorkout", () => {
  it("draws the asked-for number, all different", () => {
    for (let i = 0; i < 50; i++) {
      const drawn = pickWorkout(book, 3);
      expect(drawn).toHaveLength(3);
      expect(new Set(drawn).size).toBe(3);
    }
  });

  it("hands back the whole book when it is shorter than the workout", () => {
    const drawn = pickWorkout(["a", "b"], 3);
    expect(drawn).toHaveLength(2);
    expect([...drawn].sort()).toEqual(["a", "b"]);
  });

  it("draws nothing from an empty book rather than hanging", () => {
    expect(pickWorkout([], 3)).toEqual([]);
  });

  it("leaves the pool it drew from untouched", () => {
    const pool = [...book];
    pickWorkout(pool, 3);
    expect(pool).toEqual(book);
  });
});

describe("randomChord", () => {
  it("never hands back the chord it was told to avoid", () => {
    for (let i = 0; i < 50; i++) expect(randomChord("C").symbol).not.toBe("C");
  });
});
