// What the recorder's card says. The interesting half is the CHOICE — message or clock, never
// both — since that one field is what decides whether a waveform is drawn at all.

import { describe, expect, it } from "vitest";
import {
  formatTake,
  NO_RECORD,
  type TakeState,
  takeReadout,
} from "./takeClock";

const rec = (over: Partial<TakeState> = {}): TakeState => ({
  recording: false,
  seconds: 0,
  takes: [],
  ...over,
});

describe("the clock", () => {
  it("reads m:ss.t", () => {
    expect(formatTake(0)).toBe("0:00.0");
    expect(formatTake(2.45)).toBe("0:02.4");
    expect(formatTake(75)).toBe("1:15.0");
    expect(formatTake(605.9)).toBe("10:05.9");
  });

  it("TRUNCATES rather than rounding", () => {
    // A clock reading 0:03.0 before three seconds have passed is wrong in the direction that
    // matters while you are watching it count up.
    expect(formatTake(2.99)).toBe("0:02.9");
    expect(formatTake(59.99)).toBe("0:59.9");
  });

  it("does not pad the minutes — a card this size buys nothing by it", () => {
    expect(formatTake(3)).toBe("0:03.0");
  });

  it("answers nonsense with zero rather than NaN on the card", () => {
    expect(formatTake(Number.NaN)).toBe("0:00.0");
    expect(formatTake(-4)).toBe("0:00.0");
    expect(formatTake(Number.POSITIVE_INFINITY)).toBe("0:00.0");
  });
});

describe("what the card shows", () => {
  it("says so when the node holds nothing at all", () => {
    expect(takeReadout(rec())).toEqual({ message: NO_RECORD });
    expect(takeReadout(undefined)).toEqual({ message: NO_RECORD });
  });

  it("counts UP while a take is being made", () => {
    expect(takeReadout(rec({ recording: true, seconds: 4.2 }))).toEqual({
      elapsed: "0:04.2",
    });
  });

  it("shows the finished take's LENGTH once it has stopped", () => {
    // The engine sends `seconds: 0` when it is not rolling, so the length has to come off the
    // take itself — reading `seconds` here would show 0:00.0 for every finished take.
    expect(takeReadout(rec({ seconds: 0, takes: [{ seconds: 9.5 }] }))).toEqual(
      {
        elapsed: "0:09.5",
      },
    );
  });

  it("counts the take being MADE, not the one before it", () => {
    const r = rec({ recording: true, seconds: 1, takes: [{ seconds: 30 }] });
    expect(takeReadout(r)).toEqual({ elapsed: "0:01.0" });
  });

  it("goes back to the message when the last take is cleared away", () => {
    expect(takeReadout(rec({ takes: [] }))).toEqual({ message: NO_RECORD });
  });

  it("never sets both, which is what the card decides on", () => {
    for (const r of [
      rec(),
      rec({ recording: true, seconds: 2 }),
      rec({ takes: [{ seconds: 2 }] }),
    ]) {
      const out = takeReadout(r);
      expect(out.message === undefined).toBe(out.elapsed !== undefined);
    }
  });
});

describe("the clock's arithmetic", () => {
  it("survives a float that truncation would round the wrong way", () => {
    // 605.9 is 6058.999… tenths in binary. Truncating that gives 10:05.8, and subtracting the
    // minutes off the seconds first makes it worse rather than better.
    expect(formatTake(605.9)).toBe("10:05.9");
    expect(formatTake(0.3)).toBe("0:00.3");
    expect(formatTake(29.7)).toBe("0:29.7");
  });

  it("rolls the minute exactly at 60", () => {
    expect(formatTake(59.9)).toBe("0:59.9");
    expect(formatTake(60)).toBe("1:00.0");
  });
});
