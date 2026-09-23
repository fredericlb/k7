// Which LRCLIB results are offered, and in what order — no network involved.

import { describe, expect, it } from "vitest";
import { rankCandidates } from "./lrclib.ts";

const rec = (over: Record<string, unknown>) => ({
  id: 1,
  trackName: "Sinnerman",
  artistName: "Nina Simone",
  albumName: "Pastel Blues",
  duration: 619,
  instrumental: false,
  syncedLyrics: "[00:11.63]Oh sinnerman",
  ...over,
});

describe("rankCandidates", () => {
  it("offers timed lyrics and instrumentals, nothing untimed", () => {
    const out = rankCandidates([
      rec({ id: 1 }),
      rec({ id: 2, syncedLyrics: null }),
      rec({ id: 3, syncedLyrics: "  " }),
      rec({ id: 4, instrumental: true }),
    ]);
    expect(out.map((c) => c.id)).toEqual([1, 4]);
    // An instrumental says so, and brings no lyrics even when the record has some.
    expect(out[0].instrumental).toBe(false);
    expect(out[1]).toMatchObject({ instrumental: true, syncedLyrics: "" });
  });

  it("puts the result nearest the track's length first", () => {
    const out = rankCandidates(
      [
        rec({ id: 1, duration: 680 }),
        rec({ id: 2, duration: 621 }),
        rec({ id: 3, duration: 400 }),
      ],
      619,
    );
    expect(out.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it("keeps LRCLIB's order when no length is known, and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => rec({ id: i }));
    const out = rankCandidates(many);
    expect(out).toHaveLength(8);
    expect(out[0].id).toBe(0);
  });
});
