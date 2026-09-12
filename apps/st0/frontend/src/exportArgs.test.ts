// The two shapes `project export` now takes. The case worth pinning is the one that must NOT
// work: the old bare `project export wav`, which would make `project export webm` mean the mixdown.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_AUDIO,
  DEFAULT_VIDEO_FORMAT,
  parseExportAsk,
  VIDEO_FORMATS,
} from "./exportArgs";

describe("project export audio", () => {
  it("takes each mixdown format", () => {
    expect(parseExportAsk("audio wav")).toEqual({
      kind: "audio",
      format: "wav",
    });
    expect(parseExportAsk("audio mp3")).toEqual({
      kind: "audio",
      format: "mp3",
    });
  });

  it("refuses a format it cannot render, and a stray word after one", () => {
    expect(parseExportAsk("audio flac")).toBeNull();
    expect(parseExportAsk("audio")).toBeNull();
    expect(parseExportAsk("audio wav mp3")).toBeNull();
  });
});

describe("project export video", () => {
  it("renders the picture WITH sound by default", () => {
    // Silent would be the surprising answer: a video of a song is a video of its sound too.
    expect(parseExportAsk("video webm")).toEqual({
      kind: "video",
      format: "webm",
      audio: DEFAULT_VIDEO_AUDIO,
    });
  });

  it("takes either container — the word is the one the file is written in", () => {
    for (const format of VIDEO_FORMATS) {
      expect(parseExportAsk(`video ${format}`)).toMatchObject({ format });
    }
    expect(DEFAULT_VIDEO_FORMAT).toBe(VIDEO_FORMATS[0]);
  });

  it("takes the audio the line names", () => {
    expect(parseExportAsk("video mp4 mp3")).toEqual({
      kind: "video",
      format: "mp4",
      audio: "mp3",
    });
  });

  it("makes a silent film when asked for one", () => {
    expect(parseExportAsk("video webm none")).toEqual({
      kind: "video",
      format: "webm",
      audio: null,
    });
  });

  it("refuses a container it cannot write, and an audio it cannot render", () => {
    expect(parseExportAsk("video mov")).toBeNull();
    expect(parseExportAsk("video")).toBeNull();
    expect(parseExportAsk("video webm flac")).toBeNull();
  });
});

describe("the shape it no longer takes", () => {
  it("REFUSES the bare old line rather than reading it as audio", () => {
    // `project export wav` used to mean the mixdown. Accepting it still would make
    // `project export mp4` mean the mixdown too, which is the opposite of what it says.
    expect(parseExportAsk("wav")).toBeNull();
    expect(parseExportAsk("mp3")).toBeNull();
    expect(parseExportAsk("webm")).toBeNull();
    expect(parseExportAsk("")).toBeNull();
  });
});

describe("reading the line", () => {
  it("is not fussy about case or spacing", () => {
    expect(parseExportAsk("  VIDEO   MP4   MP3 ")).toEqual({
      kind: "video",
      format: "mp4",
      audio: "mp3",
    });
  });
});
