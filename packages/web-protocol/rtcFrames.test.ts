// rtcFrames.test.ts — a frame cut into fragments comes back byte for byte, text or binary, at
// every size around the fragment boundary.

import { describe, expect, it } from "vitest";
import {
  FragmentJoiner,
  RTC_FRAGMENT_BYTES,
  toFragments,
} from "./rtcFrames.ts";

const roundTrip = (data: string | Uint8Array) => {
  const j = new FragmentJoiner();
  const frags = toFragments(data);
  const got = frags.map((f) => j.push(f));
  expect(got.slice(0, -1).every((g) => g === null)).toBe(true);
  for (const f of frags)
    expect(f.length).toBeLessThanOrEqual(RTC_FRAGMENT_BYTES);
  return { frames: frags.length, last: got.at(-1) };
};

describe("rtc fragments", () => {
  it("carries an empty text and an empty binary", () => {
    expect(roundTrip("").last).toEqual({ text: "" });
    expect(roundTrip(new Uint8Array(0)).last).toEqual({
      binary: new Uint8Array(0),
    });
  });

  it("round-trips text at the fragment boundary, and past it", () => {
    for (const n of [
      1,
      RTC_FRAGMENT_BYTES - 2,
      RTC_FRAGMENT_BYTES - 1,
      RTC_FRAGMENT_BYTES,
      3 * RTC_FRAGMENT_BYTES + 7,
    ]) {
      const s = "é".repeat(Math.ceil(n / 2)).slice(0, n);
      expect(roundTrip(s).last).toEqual({ text: s });
    }
  });

  it("round-trips a large binary in several fragments", () => {
    const b = new Uint8Array(100_000).map((_, i) => i % 251);
    const { frames, last } = roundTrip(b);
    expect(frames).toBeGreaterThan(5);
    expect(last).toEqual({ binary: b });
  });

  it("keeps consecutive frames apart", () => {
    const j = new FragmentJoiner();
    const out = [...toFragments("a"), ...toFragments("b".repeat(40_000))]
      .map((f) => j.push(f))
      .filter(Boolean);
    expect(out).toEqual([{ text: "a" }, { text: "b".repeat(40_000) }]);
  });
});
