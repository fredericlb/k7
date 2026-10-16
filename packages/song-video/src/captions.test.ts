// Subtitles read into cues: what would go wrong silently is a VTT cue's settings read as its end,
// a comma-decimal SRT time read as whole seconds, markup drawn as text, and a broken block
// dropped without a word.

import { describe, expect, it } from "vitest";
import { parseCaptions } from "./captions";

describe("parseCaptions", () => {
  it("reads an SRT, comma decimals and multi-line cues", () => {
    const { cues, problems } = parseCaptions(
      "1\n00:00:01,500 --> 00:00:04,000\nHello,\nworld\n\n2\n00:00:05,000 --> 00:00:06,250\n<i>Again</i>\n",
    );
    expect(problems).toEqual([]);
    expect(cues).toEqual([
      { start: 1.5, end: 4, text: "Hello,\nworld" },
      { start: 5, end: 6.25, text: "Again" },
    ]);
  });

  it("reads WebVTT, skipping its header and notes, and ignoring cue settings", () => {
    const { cues } = parseCaptions(
      "WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.500 align:start line:90%\nFirst\n",
    );
    expect(cues).toEqual([{ start: 1, end: 2.5, text: "First" }]);
  });

  it("names a block it cannot read, and keeps the others", () => {
    const { cues, problems } = parseCaptions(
      "1\n00:00:01,000 --> 00:00:00,500\nBackwards\n\n2\n00:00:02,000 --> 00:00:03,000\nFine\n",
    );
    expect(cues.map((c) => c.text)).toEqual(["Fine"]);
    expect(problems).toEqual([
      "block 1: cannot read '00:00:01,000 --> 00:00:00,500'",
    ]);
  });
});
