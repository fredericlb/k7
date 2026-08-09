import { describe, expect, it } from "vitest";
import {
  barsIn,
  beatsIn,
  BEATS_PER_BAR,
  bucketAt,
  type Envelope,
  mmss,
  transientsIn,
  WINDOW_SECONDS,
  window,
  xOf,
} from "./waveform";

const env = (over: Partial<Envelope> = {}): Envelope => ({
  sampleRate: 48000,
  channels: 2,
  frames: 48000 * 120,
  seconds: 120,
  peak: Array.from({ length: 8192 }, (_, i) => (i % 100) / 100),
  rms: [],
  transients: [1, 1.5, 2.25, 10],
  sensitivity: 2,
  bpm: 120, // 0.5 s a beat — round numbers, so a drifting grid is obvious
  ...over,
});

describe("the window follows the playhead", () => {
  it("puts the playhead in the middle", () => {
    expect(window(60)).toEqual([
      60 - WINDOW_SECONDS / 2,
      60 + WINDOW_SECONDS / 2,
    ]);
    expect(xOf(60, 60)).toBeCloseTo(0.5);
  });

  it("does NOT slide to stay inside the song", () => {
    // At the top of a track the left half is before zero, and it is drawn empty. A window
    // that clamped would move the playhead off centre — which is the one promise this view
    // makes — and would hide that you are at the beginning.
    const [from, to] = window(0);
    expect(from).toBeLessThan(0);
    expect(to).toBe(WINDOW_SECONDS / 2);
    expect(xOf(0, 0)).toBeCloseTo(0.5);
  });

  it("maps a second to a fraction of the view, off-screen included", () => {
    expect(xOf(60 - WINDOW_SECONDS / 2, 60)).toBeCloseTo(0);
    expect(xOf(60 + WINDOW_SECONDS / 2, 60)).toBeCloseTo(1);
    // Past the right edge: negative and >1 are how the caller knows to skip a line.
    expect(xOf(200, 60)).toBeGreaterThan(1);
    expect(xOf(1, 60)).toBeLessThan(0);
  });
});

describe("finding a bucket", () => {
  it("scales by the song's OWN length, not a fixed rate", () => {
    // 8192 buckets whatever the duration, so seconds-per-bucket differs per song. Assuming
    // otherwise would draw one track's waveform at another's speed.
    const short = env({ seconds: 100 });
    const long = env({ seconds: 200 });
    expect(bucketAt(short, 50)).toBe(4096);
    expect(bucketAt(long, 50)).toBe(2048);
  });

  it("answers null outside the file rather than clamping to an end", () => {
    // Clamping would smear the last bucket across the whole run-out, which reads as audio
    // that is not there.
    expect(bucketAt(env(), -1)).toBe(null);
    expect(bucketAt(env(), 120)).toBe(null);
    expect(bucketAt(env(), 119.9)).not.toBe(null);
  });

  it("answers null for an envelope with nothing in it", () => {
    expect(bucketAt(env({ peak: [], seconds: 0 }), 1)).toBe(null);
  });
});

describe("the beat grid", () => {
  it("is anchored on the first transient, not on zero", () => {
    // A tempo says the SPACING; nothing in the médiathèque says where beat one is. The first
    // onset is the best guess available, and a grid from 0 would be wrong for any lead-in.
    //
    // The anchor is 1 s and the beats land on it — AND the grid runs backwards from there
    // through the lead-in, because those two seconds are part of the track too.
    expect(beatsIn(env(), 0, 3)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    // Shift the first onset by a quarter beat and the whole grid shifts with it.
    expect(beatsIn(env({ transients: [1.25] }), 0.9, 2)).toEqual([1.25, 1.75]);
  });

  it("extends backwards through the lead-in, but never before zero", () => {
    const beats = beatsIn(env({ transients: [5] }), 0, 6);
    expect(beats[0]).toBeCloseTo(0);
    expect(beats.every((b) => b >= 0)).toBe(true);
    expect(beats).toContain(5);
  });

  it("draws NOTHING when the tempo is unknown", () => {
    // 0 is the engine's "no tempo found". A grid at a guessed 120 would be a confident lie;
    // no yellow lines reads correctly as "we do not know".
    expect(beatsIn(env({ bpm: 0 }), 0, 60)).toEqual([]);
  });

  it("stays bounded when a bad tempo meets a long window", () => {
    const many = beatsIn(env({ bpm: 100000 }), 0, 600, 512);
    expect(many.length).toBe(512);
  });

  it("returns nothing for an empty or inverted window", () => {
    expect(beatsIn(env(), 5, 5)).toEqual([]);
    expect(beatsIn(env(), 10, 2)).toEqual([]);
  });
});

describe("the clock on the strip", () => {
  it("pads the seconds, so the digits do not jump", () => {
    expect(mmss(0)).toBe("0:00");
    expect(mmss(9)).toBe("0:09");
    expect(mmss(61)).toBe("1:01");
    expect(mmss(3599)).toBe("59:59");
  });

  it("floors rather than rounds, so 0:59 never shows as 1:00", () => {
    expect(mmss(59.9)).toBe("0:59");
  });

  it("signs what is LEFT, which is a negative number", () => {
    expect(mmss(-5)).toBe("-0:05");
    expect(mmss(-125)).toBe("-2:05");
  });
});

describe("the transients", () => {
  it("are the ones inside the window, untouched", () => {
    expect(transientsIn(env(), 1.2, 9)).toEqual([1.5, 2.25]);
  });

  it("include both edges", () => {
    expect(transientsIn(env(), 1, 1.5)).toEqual([1, 1.5]);
  });
});

describe("the bar lines", () => {
  // A grid on the beat at 120 bpm — a beat every 0.5 s, a bar every 2 s.
  const env = (over: Partial<Envelope> = {}): Envelope =>
    ({
      sampleRate: 48000,
      channels: 2,
      frames: 0,
      seconds: 300,
      peak: [],
      rms: [],
      transients: Array.from({ length: 64 }, (_, i) => i * 0.5),
      sensitivity: 2,
      bpm: 120,
      ...over,
    }) as Envelope;

  it("falls on every fourth beat", () => {
    // 4/4 is ASSUMED — nothing in the sidecar carries a metre — so the first beat of the grid
    // is taken as a downbeat and every fourth after it follows.
    const bars = barsIn(env(), 0, 8);
    expect(bars).toHaveLength(5); // 0, 2, 4, 6, 8
    for (const [i, b] of bars.entries()) expect(b).toBeCloseTo(i * BEATS_PER_BAR * 0.5, 6);
  });

  it("sits ON beats, never between them", () => {
    // The one way this could look right and be wrong: a bar grid with its own anchor would
    // drift against the yellow lines it is supposed to pick out.
    const beats = beatsIn(env(), 0, 8);
    for (const b of barsIn(env(), 0, 8))
      expect(beats.some((x) => Math.abs(x - b) < 1e-6)).toBe(true);
  });

  it("draws none at all without a tempo", () => {
    // Same rule as the beats: a grid at a guessed 120 would be a confident lie, and no lines
    // reads correctly as "the tempo is not known".
    expect(barsIn(env({ bpm: 0 }), 0, 8)).toEqual([]);
  });

  it("is capped, so a bad tempo cannot ask for thousands", () => {
    expect(barsIn(env({ bpm: 20000 }), 0, 600).length).toBeLessThanOrEqual(128);
  });
});
