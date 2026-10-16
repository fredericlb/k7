import { input } from "@studio/ffmpeg";
import { describe, expect, it } from "vitest";
import { extractAudioArgs, parseSrt, srtOf } from "./transcribe";

// The SRT dialect is the one decision here worth pinning: both whisper CLIs write it, the track's
// `content:` carries it, and whoever copies it out gets a valid subtitle file. Raw timings are the
// SOURCE video's own seconds — that is what the verb's log says, and what these tests keep true.

const CUE = `1
00:00:01,000 --> 00:00:04,120
Hello there

2
00:00:05,500 --> 00:00:08,000
And welcome`;

describe("parseSrt", () => {
  it("reads cues into seconds, keeping each cue's text whole", () => {
    expect(parseSrt(CUE)).toEqual([
      { start: 1, end: 4.12, text: "Hello there" },
      { start: 5.5, end: 8, text: "And welcome" },
    ]);
  });

  it("joins a cue's wrapped lines into one sentence", () => {
    const wrapped = `1
00:00:00,000 --> 00:00:02,000
the quick brown fox
jumps over the dog`;
    expect(parseSrt(wrapped)).toEqual([
      { start: 0, end: 2, text: "the quick brown fox jumps over the dog" },
    ]);
  });

  it("reads whisper.cpp's dot-milliseconds spelling, and a cue with no index", () => {
    const cpp = `00:00:01.500 --> 00:00:03.250
first`;
    expect(parseSrt(cpp)).toEqual([{ start: 1.5, end: 3.25, text: "first" }]);
  });

  it("skips what is not a cue — a stray number, a header, a blank block", () => {
    const noisy = `WEBVTT-ish header

1
not a timing line

2
00:00:02,000 --> 00:00:03,000
kept

3
00:00:04,000 --> 00:00:05,000
`;
    expect(parseSrt(noisy)).toEqual([{ start: 2, end: 3, text: "kept" }]);
  });

  it("parses back what srtOf wrote — the round trip is the contract", () => {
    const segments = parseSrt(CUE);
    expect(parseSrt(srtOf(segments))).toEqual(segments);
  });

  it("keeps the timing text valid SRT: commas, three millisecond digits, 1-based numbering", () => {
    const srt = srtOf([{ start: 0, end: 1.5, text: "one" }]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,500\none\n");
  });
});

describe("extractAudioArgs", () => {
  it("opens the user's video under the protocol whitelist", () => {
    const args = extractAudioArgs("/ws/clip.mov", "/tmp/a.wav");
    expect(args.join("\0")).toContain(input("/ws/clip.mov").join("\0"));
  });
});
