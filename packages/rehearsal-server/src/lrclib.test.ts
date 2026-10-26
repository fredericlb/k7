// Which LRCLIB results are offered, and in what order — no network involved.

import { describe, expect, it } from "vitest";
import { pickRecord, rankCandidates } from "./lrclib.ts";

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

describe("pickRecord, for a lookup nobody reviews", () => {
  it("takes the record whose length is the track's, timed lyrics first", () => {
    const records = [
      rec({ id: 1, duration: 300, syncedLyrics: "[00:01.00]far" }),
      rec({ id: 2, duration: 621, syncedLyrics: null, plainLyrics: "plain" }),
      rec({ id: 3, duration: 621, syncedLyrics: "[00:01.00]near" }),
    ];
    expect(pickRecord(records, "Nina Simone", "Sinnerman", 619)).toEqual({
      kind: "synced",
      text: "[00:01.00]near",
    });
  });

  it("keeps plain lyrics when nothing timed fits", () => {
    const records = [
      rec({ duration: 620, syncedLyrics: null, plainLyrics: "Oh sinnerman" }),
    ];
    expect(pickRecord(records, "Nina Simone", "Sinnerman", 619)).toEqual({
      kind: "plain",
      text: "Oh sinnerman",
    });
  });

  it("takes nothing whose length is another recording's", () => {
    expect(
      pickRecord([rec({ duration: 240 })], "Nina Simone", "Sinnerman", 619),
    ).toBeNull();
  });

  it("with no length, wants the very names, accents and case aside", () => {
    expect(
      pickRecord([rec({ trackName: "SINNERMAN" })], "nina simone", "Sinnerman"),
    ).toMatchObject({ kind: "synced" });
    expect(
      pickRecord(
        [rec({ trackName: "Sinnerman (Live)" })],
        "Nina Simone",
        "Sinnerman",
      ),
    ).toBeNull();
  });

  it("says instrumental when the fitting record is one", () => {
    expect(
      pickRecord(
        [rec({ instrumental: true })],
        "Nina Simone",
        "Sinnerman",
        619,
      ),
    ).toEqual({ kind: "instrumental" });
  });
});
