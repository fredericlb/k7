import { describe, expect, it } from "vitest";
import type { Song } from "../types";
import { buildSongPdf, toWinAnsi, wrapMonospace } from "./songPdf";

const song = (over: Partial<Song> = {}): Song => ({
  id: "s1",
  artist: "Nina Simone",
  title: "Sinnerman",
  lyrics: "Oh sinnerman, where you gonna run to?",
  tablature: "e|---0---|",
  sheets: [],
  audio: null,
  instrumental: null,
  lyricTimings: [],
  fetchStatus: { phase: "", progress: null, error: "", huntId: "", jobId: "" },
  lyricsMatch: "",
  fetchIgnored: false,
  favorite: false,
  mine: false,
  createdAt: "2026-09-07T10:00:00Z",
  ...over,
});

describe("toWinAnsi", () => {
  it("leaves accented Latin text alone", () => {
    expect(toWinAnsi("Où sont les fêtes ?")).toBe("Où sont les fêtes ?");
  });

  it("spells the two accidentals a songbook actually carries", () => {
    expect(toWinAnsi("B♭ then F♯")).toBe("Bb then F#");
  });

  it("replaces what no standard font can draw", () => {
    expect(toWinAnsi("song 歌")).toBe("song ?");
  });

  it("expands tabs and normalises line ends", () => {
    expect(toWinAnsi("a\tb\r\nc")).toBe("a    b\nc");
  });
});

describe("wrapMonospace", () => {
  it("leaves a short line whole", () => {
    expect(wrapMonospace("short", 10)).toEqual(["short"]);
  });

  it("breaks on a space and eats it", () => {
    expect(wrapMonospace("hello brave world", 12)).toEqual([
      "hello brave",
      "world",
    ]);
  });

  it("cuts a chord grid that offers no break", () => {
    expect(wrapMonospace("e|--------------------|", 10)).toEqual([
      "e|--------",
      "----------",
      "--|",
    ]);
  });
});

describe("buildSongPdf", () => {
  it("builds a PDF that a reader can open", async () => {
    const { bytes, skipped } = await buildSongPdf(song());
    expect(skipped).toEqual([]);
    // %PDF- is the whole of a PDF's magic; anything else is not one.
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    const read = await PDFDocument.load(bytes);
    expect(read.getPageCount()).toBe(1);
    expect(read.getTitle()).toBe("Sinnerman");
    expect(read.getAuthor()).toBe("Nina Simone");
  });

  it("appends the pages of a PDF sheet", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.create();
    source.addPage();
    source.addPage();
    const sheet = {
      name: "score.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array(await source.save()),
    };

    const { bytes, skipped } = await buildSongPdf(song(), [sheet]);
    const read = await PDFDocument.load(bytes);
    expect(read.getPageCount()).toBe(3);
    expect(skipped).toEqual([]);
  });

  it("keeps the song when a sheet is unreadable", async () => {
    const { bytes, skipped } = await buildSongPdf(song(), [
      { name: "broken.pdf", mime: "application/pdf", bytes: new Uint8Array(9) },
    ]);
    expect(skipped).toEqual(["broken.pdf"]);
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("spills a long song onto more than one page", async () => {
    const long = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    const { bytes } = await buildSongPdf(song({ lyrics: long }));
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
