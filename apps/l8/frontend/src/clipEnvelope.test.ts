// The one thing this key has to do is MISS when the picture would differ. Each test below is an
// edit somebody makes on the timeline, and the question is always the same: does the block go on
// showing the envelope it had? `clip trim` is the one that was reported, and the one the id alone
// could never catch.

import { describe, expect, it } from "vitest";
import { clipEnvelopeKey, type EnvelopeProject } from "./clipEnvelope";
import type { WebClip } from "./types";

const project: EnvelopeProject = { tempo: 120, timeSigNumerator: 4 };

const clip = (over: Partial<WebClip> = {}): WebClip => ({
  id: "riff",
  type: "audio",
  name: "riff",
  start: 0,
  length: 8,
  offset: 0,
  sourceName: "riff.wav",
  notes: [],
  ...over,
});

/** Both keys at the same bucket count — the pair every test below compares. */
const keys = (a: WebClip, b: WebClip, buckets = 160): [string, string] => [
  clipEnvelopeKey(a, project, buckets),
  clipEnvelopeKey(b, project, buckets),
];

describe("what makes the envelope a different one", () => {
  it("a TRIM — the reported bug, and the id cannot see it", () => {
    // `clip trim` rewrites the clip file's from/to and nothing else: same id, same start, same
    // length. Keyed on the id, the trimmed block was answered with the untrimmed envelope for
    // the rest of the session, because nothing ever evicted it.
    const [before, after] = keys(clip(), clip({ sourceFrom: 1.5 }));
    expect(after).not.toBe(before);
  });

  it("a trim of the tail alone", () => {
    const [before, after] = keys(clip(), clip({ sourceTo: 3 }));
    expect(after).not.toBe(before);
  });

  it("a BOUNCE — `clip process` repoints the clip at a new file", () => {
    // The other way the material changes while the placement stays put. Every run is its own
    // file now (a wall-clock stamp), so the name is what says the block is playing something else.
    const [before, after] = keys(
      clip(),
      clip({ sourceName: "riff_normalize_260816T101500.wav" }),
    );
    expect(after).not.toBe(before);
  });

  it("a resize, a move, a new in-point", () => {
    const base = clip();
    for (const over of [{ length: 4 }, { start: 16 }, { offset: 0.25 }]) {
      const [before, after] = keys(base, clip(over));
      expect(after, JSON.stringify(over)).not.toBe(before);
    }
  });

  it("a warp turned on — the fact reaches the browser even though the markers do not", () => {
    const [before, after] = keys(clip(), clip({ warped: true }));
    expect(after).not.toBe(before);
  });

  it("a tempo change — it decides how much of the source a fixed length shows", () => {
    expect(clipEnvelopeKey(clip(), { ...project, tempo: 90 }, 160)).not.toBe(
      clipEnvelopeKey(clip(), project, 160),
    );
  });

  it("a different bucket count — the same audio, drawn at another resolution", () => {
    expect(clipEnvelopeKey(clip(), project, 1000)).not.toBe(
      clipEnvelopeKey(clip(), project, 160),
    );
  });
});

describe("what leaves it alone", () => {
  it("the things that only change how the block LOOKS", () => {
    // A rename, a mute, a freeze flag: none of them touch which audio is under the block, and a
    // key that moved on them would throw the envelope away on every one of these edits.
    const base = clip();
    for (const over of [
      { name: "riff (take 2)" },
      { disabled: true },
      { frozen: true },
    ]) {
      const [before, after] = keys(base, clip(over));
      expect(after, JSON.stringify(over)).toBe(before);
    }
  });

  it("two placements of one clip share an envelope — until one is moved", () => {
    // Same id and same window: the second placement costs no second decode, which is the whole
    // reason there is a cache. `start` is in the key, so placing it elsewhere does split them.
    const [a, b] = keys(clip(), clip());
    expect(b).toBe(a);
  });

  it("…and an absent window is not spelt like a zero one", () => {
    // The two draw the SAME picture, so this costs one redundant refetch when a trim writes a
    // `from` of 0. Kept anyway: `?? ""` is what keeps `sourceFrom: 1` and `sourceTo: 1` from
    // colliding once the fields are joined into one string, and a key that is loose about
    // absence in one place is loose about it everywhere.
    const [absent, zero] = keys(clip(), clip({ sourceFrom: 0 }));
    expect(zero).not.toBe(absent);
  });
});
