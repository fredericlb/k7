// A song page shows tabs only for what the song holds, plus the kind being added.

import { describe, expect, it } from "vitest";
import { hasContent, missingTabs, visibleTabs } from "./songTabs";
import type { Song } from "./types";

const song = (over: Partial<Song> = {}): Song => ({
  id: "s1",
  artist: "Nina Simone",
  title: "Sinnerman",
  lyrics: "",
  tablature: "",
  sheets: [],
  audio: null,
  instrumental: null,
  lyricTimings: [],
  fetchStatus: { phase: "", progress: null, error: "", huntId: "", jobId: "" },
  lyricsMatch: "",
  favorite: false,
  mine: false,
  createdAt: "2026-09-07T10:00:00Z",
  ...over,
});

const sheet = {
  id: "f1",
  name: "part.mxl",
  mime: "application/vnd.recordare.musicxml",
};

describe("visibleTabs", () => {
  it("shows nothing for an empty song", () => {
    expect(visibleTabs(song(), null)).toEqual([]);
    expect(missingTabs(song(), null)).toEqual(["lyrics", "tablature", "sheet"]);
  });

  it("shows only what the song holds, in the fixed order", () => {
    expect(visibleTabs(song({ sheets: [sheet], lyrics: "la" }), null)).toEqual([
      "lyrics",
      "sheet",
    ]);
    expect(visibleTabs(song({ tablature: "e|--0--|" }), null)).toEqual([
      "tablature",
    ]);
  });

  it("adds the kind being added, and stops offering it", () => {
    const s = song({ lyrics: "la" });
    expect(visibleTabs(s, "sheet")).toEqual(["lyrics", "sheet"]);
    expect(missingTabs(s, "sheet")).toEqual(["tablature"]);
  });

  it("counts whitespace as nothing", () => {
    expect(hasContent(song({ lyrics: "  \n" }), "lyrics")).toBe(false);
  });
});
