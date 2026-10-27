import type { MediatekEntry, SongbookSong } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import {
  addedOn,
  clampSemitones,
  followedLine,
  songBpm,
  songChords,
} from "./songExtras";

const entry = (over: Partial<MediatekEntry> = {}): MediatekEntry =>
  ({
    family: "songs",
    id: "a/b",
    name: "b",
    path: "a/b",
    kind: "",
    mtime: 1_700_000_000_000,
    ...over,
  }) as MediatekEntry;

const song = (createdAt: string) =>
  ({ facts: { createdAt } }) as unknown as SongbookSong;

describe("songChords", () => {
  it("lists the chords' text first, then the lyrics' inline chords, each once", () => {
    expect(songChords("Am F\nla la", "[C]la [Am]la", 0)).toEqual([
      "Am",
      "F",
      "C",
    ]);
  });
  it("transposes, and merges two spellings that land on one chord", () => {
    expect(songChords("C D", "", 2)).toEqual(["D", "E"]);
    expect(songChords("C", "[D]x", 2)).toEqual(["D", "E"]);
  });
  it("is empty for a song with no chords", () => {
    expect(songChords("", "just words\nhere", 0)).toEqual([]);
  });
});

describe("addedOn", () => {
  it("prefers the songbook's date", () => {
    const got = addedOn(song("2024-05-01T10:00:00Z"), entry());
    expect(got?.from).toBe("songbook");
    expect(got?.at.toISOString()).toBe("2024-05-01T10:00:00.000Z");
  });
  it("falls back on the folder's file time", () => {
    expect(addedOn(null, entry())?.from).toBe("files");
    expect(addedOn(song(""), entry())?.from).toBe("files");
    expect(addedOn(null, entry({ mtime: 0 }))).toBeNull();
  });
});

describe("songBpm", () => {
  it("reads a number or a numeric string, clamped", () => {
    expect(songBpm({ bpm: 128 })).toBe(128);
    expect(songBpm({ bpm: "92.4" })).toBe(92);
    expect(songBpm({ bpm: 400 })).toBe(240);
  });
  it("is null when there is none", () => {
    expect(songBpm({})).toBeNull();
    expect(songBpm({ bpm: "" })).toBeNull();
    expect(songBpm({ bpm: 0 })).toBeNull();
    expect(songBpm(undefined)).toBeNull();
  });
});

describe("followedLine", () => {
  const timings = new Map([
    [1, 5],
    [3, 10],
  ]);
  it("is the last line whose time has come", () => {
    expect(followedLine(timings, 7, true)).toBe(1);
    expect(followedLine(timings, 12, true)).toBe(3);
    expect(followedLine(timings, 2, true)).toBeNull();
  });
  it("follows nothing while another song plays or at rest", () => {
    expect(followedLine(timings, 7, false)).toBeNull();
    expect(followedLine(timings, 0, true)).toBeNull();
  });
});

describe("clampSemitones", () => {
  it("keeps within an octave", () => {
    expect(clampSemitones(14)).toBe(11);
    expect(clampSemitones(-20)).toBe(-11);
    expect(clampSemitones(2)).toBe(2);
  });
});
