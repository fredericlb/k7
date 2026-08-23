import { describe, expect, it } from "vitest";
import { BAND_COLOURS, bandsAt, columnColour } from "./spectrumColour";

/** `rgb(r,g,b)` back to numbers, so a test can talk about hue rather than about a string. */
const rgb = (s: string): [number, number, number] => {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(s);
  if (!m) throw new Error(`not an rgb string: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

describe("what colour a column is", () => {
  it("is RED where the bass is", () => {
    const [r, g, b] = rgb(columnColour({ low: 0.8, mid: 0.02, high: 0.01 }));
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(200);
  });

  it("is GREEN where the voice is", () => {
    const [r, g, b] = rgb(columnColour({ low: 0.02, mid: 0.8, high: 0.02 }));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("is BLUE where the cymbals are", () => {
    const [r, g, b] = rgb(columnColour({ low: 0.01, mid: 0.05, high: 0.8 }));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("BLENDS, which is the whole point of doing it additively", () => {
    // Ordinary light — yellow-orange, purple, white — rather than a table of special cases.
    const [r1, g1, b1] = rgb(columnColour({ low: 0.8, mid: 0.8, high: 0.02 }));
    expect(r1).toBeGreaterThan(150);
    expect(g1).toBeGreaterThan(150);
    expect(b1).toBeLessThan(120);

    const [r2, g2, b2] = rgb(columnColour({ low: 0.8, mid: 0.02, high: 0.8 }));
    expect(r2).toBeGreaterThan(150);
    expect(b2).toBeGreaterThan(150);
    expect(g2).toBeLessThan(150);

    const [r3, g3, b3] = rgb(columnColour({ low: 0.8, mid: 0.8, high: 0.8 }));
    expect(Math.min(r3, g3, b3)).toBeGreaterThan(200); // white
  });

  it("says the same thing quietly as it does loudly", () => {
    // It reports which band DOMINATES, so a quiet bassline is as much bass as a loud one.
    expect(columnColour({ low: 0.9, mid: 0.3, high: 0.1 })).toBe(
      columnColour({ low: 0.09, mid: 0.03, high: 0.01 }),
    );
  });

  it("keeps a pure band PURE rather than a third of the way there", () => {
    // Why it divides by the LOUDEST and not the total: a sum would read pure bass as muddy brown.
    expect(rgb(columnColour({ low: 0.5, mid: 0, high: 0 }))).toEqual([
      ...BAND_COLOURS.low,
    ]);
  });

  it("falls back rather than drawing black on black", () => {
    expect(columnColour({ low: 0, mid: 0, high: 0 })).toBe("rgb(148,163,184)");
    expect(columnColour({ low: 0, mid: 0, high: 0 }, "rgb(1,2,3)")).toBe(
      "rgb(1,2,3)",
    );
  });
});

describe("reading a column's bands", () => {
  const env = { low: [0.5], mid: [0.2], high: [0.1] };

  it("takes all three at one index", () => {
    expect(bandsAt(env, 0)).toEqual({ low: 0.5, mid: 0.2, high: 0.1 });
  });

  it("says NOTHING for a file analysed before the bands existed", () => {
    // A v3 sidecar has none: null draws the plain envelope, where zeroes would read as silence.
    expect(bandsAt({}, 0)).toBeNull();
    expect(bandsAt({ low: [0.5], mid: [0.2] }, 0)).toBeNull();
  });

  it("says nothing past the end of the arrays", () => {
    expect(bandsAt(env, 5)).toBeNull();
  });
});
