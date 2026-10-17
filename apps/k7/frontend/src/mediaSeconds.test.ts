import { describe, expect, it } from "vitest";
import { secondsOf } from "./mediaSeconds";

describe("secondsOf", () => {
  it("floors a measured duration to the millisecond", () => {
    expect(secondsOf(12.34567)).toBe(12.345);
  });

  it("answers null for what a browser cannot measure", () => {
    expect(secondsOf(Number.NaN)).toBeNull();
    expect(secondsOf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(secondsOf(0)).toBeNull();
  });
});
