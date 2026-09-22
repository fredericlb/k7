import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Song } from "../types";
import { buildSongbookZip } from "./songbookZip";

const song = (over: Partial<Song> = {}): Song => ({
  id: "s1",
  artist: "Nina Simone",
  title: "Sinnerman",
  lyrics: "Oh sinnerman",
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

const magic = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.slice(0, 5));

describe("buildSongbookZip", () => {
  it("puts one PDF per song in the zip, named after the song", async () => {
    const result = await buildSongbookZip("pdf", [
      song(),
      song({ id: "s2", artist: "Nina Simone", title: "Feeling Good" }),
    ]);

    const files = unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual([
      "Nina Simone - Feeling Good.pdf",
      "Nina Simone - Sinnerman.pdf",
    ]);
    for (const bytes of Object.values(files))
      expect(magic(bytes)).toBe("%PDF-");
    expect(result.songs).toBe(2);
    expect(result.failed).toEqual([]);
  });

  it("numbers two songs that name the same file", async () => {
    const result = await buildSongbookZip("pdf", [song(), song({ id: "s2" })]);
    expect(Object.keys(unzipSync(result.bytes)).sort()).toEqual([
      "Nina Simone - Sinnerman-2.pdf",
      "Nina Simone - Sinnerman.pdf",
    ]);
  });

  it("counts every song on the way through", async () => {
    const seen: number[] = [];
    await buildSongbookZip(
      "pdf",
      [song(), song({ id: "s2" }), song({ id: "s3" })],
      (done, total) => {
        expect(total).toBe(3);
        seen.push(done);
      },
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it("names the zip after the format and the day", async () => {
    const { file } = await buildSongbookZip("pdf", [song()]);
    expect(file).toMatch(/^songbook-pdf-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});
