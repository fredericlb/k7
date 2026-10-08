// A comped event compiles to plain clips: audio slices move their window into the FILE, MIDI ones
// their window over the NOTES, and the recording hole is the same slice with nothing put back.

import { describe, expect, it } from "vitest";
import { compClips, cutHole, markCrossfades, sliceClip } from "./compClips";
import type { ClipDoc } from "./project";

// 120 bpm: one beat is half a second.
const TEMPO = 120;

const audio = (name: string, start: number, length: number): ClipDoc => ({
  id: `${name}@${start}`,
  type: "audio",
  name,
  source: `/clips/${name}.wav`,
  start,
  length,
  offset: 0,
  sourceFrom: 0,
  sourceTo: length / 2,
  fadeIn: 1,
  fadeOut: 1,
  loopStart: 0,
  loopEnd: 0,
  notes: [],
});

describe("sliceClip", () => {
  it("moves an audio window into the file, in seconds, and drops the event's fades", () => {
    const s = sliceClip(audio("gtr", 16, 8), 2, 2, 18, TEMPO);
    expect(s).toMatchObject({
      start: 18,
      length: 2,
      sourceFrom: 1,
      sourceTo: 2,
      fadeIn: 0,
      fadeOut: 0,
    });
  });

  it("moves a MIDI window over the notes, in beats", () => {
    const seq: ClipDoc = {
      ...audio("keys", 0, 8),
      type: "midi",
      source: "",
      loopStart: 0,
      loopEnd: 0,
    };
    const s = sliceClip(seq, 4, 2, 4, TEMPO);
    expect(s).toMatchObject({ start: 4, length: 2, loopStart: 4, loopEnd: 6 });
  });
});

describe("compClips", () => {
  it("plays the take over its span and the event's own material around it, each piece marked", () => {
    const own = audio("gtr", 16, 8);
    const take = audio("gtr_t2", 16, 12);
    const clips = compClips(
      {
        ref: "gtr",
        start: "5:1",
        takes: [{ ref: "gtr_t2", start: "5:1" }],
        comp: [{ take: "gtr_t2", from: "5:3", to: "8:1" }],
      },
      own,
      () => take,
      4,
      4,
      TEMPO,
    );
    expect(clips.map((c) => [c.name, c.start, c.length])).toEqual([
      ["gtr", 16, 2],
      ["gtr_t2", 18, 10],
    ]);
    expect(clips.every((c) => c.comp?.of === own.id)).toBe(true);
  });

  it("leaves an event with no comp, or a looped one, as its one clip", () => {
    const own = audio("gtr", 16, 8);
    expect(compClips({ ref: "gtr" }, own, () => own, 4, 4, TEMPO)).toEqual([
      own,
    ]);
    expect(
      compClips(
        { ref: "gtr", loop: 2, comp: [{ take: "x", from: "5:1", to: "6:1" }] },
        own,
        () => own,
        4,
        4,
        TEMPO,
      ),
    ).toEqual([own]);
  });
});

describe("cutHole", () => {
  it("silences a span, keeping both sides", () => {
    const clips = cutHole([audio("gtr", 16, 8)], 18, 20, TEMPO);
    expect(clips.map((c) => [c.start, c.length, c.sourceFrom])).toEqual([
      [16, 2, 0],
      [20, 4, 2],
    ]);
  });
});

describe("markCrossfades", () => {
  it("marks two clips overlapping by exactly their two fades, and nothing else", () => {
    const a = { ...audio("a", 0, 8), fadeIn: 0, fadeOut: 1 };
    const b = { ...audio("b", 7, 8), fadeIn: 1, fadeOut: 0 };
    const c = { ...audio("c", 20, 4), fadeIn: 1, fadeOut: 0 };
    const [ma, mb, mc] = markCrossfades([a, b, c]);
    expect(ma.crossfade).toEqual({ out: true });
    expect(mb.crossfade).toEqual({ in: true });
    expect(mc.crossfade).toBeUndefined();
  });
});
