// decode.test.ts — the mono sum, which is where a chunk boundary gets a decode wrong. ffmpeg
// itself is not exercised here: it is absent from a dev machine and present in the image.

import { describe, expect, it } from "vitest";
import { monoFromInterleaved } from "./decode.ts";

/** An interleaved f32 buffer from per-channel sample lists. */
function interleave(channels: number[][]): Buffer {
  const frames = channels[0].length;
  const buf = Buffer.alloc(frames * channels.length * 4);
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < channels.length; c++)
      buf.writeFloatLE(channels[c][f], (f * channels.length + c) * 4);
  return buf;
}

describe("monoFromInterleaved", () => {
  it("averages a stereo pair", () => {
    const buf = interleave([
      [1, 0, -1],
      [0, 1, -1],
    ]);
    expect([...monoFromInterleaved(buf, 2, 3)]).toEqual([0.5, 0.5, -1]);
  });

  it("passes mono through untouched", () => {
    const buf = interleave([[0.25, -0.5]]);
    expect([...monoFromInterleaved(buf, 1, 2)]).toEqual([0.25, -0.5]);
  });

  // JUCE takes the FIRST two channels rather than downmixing, so a centre channel is not weighted in.
  it("ignores every channel past the second", () => {
    const buf = interleave([
      [1, 1],
      [0, 0],
      [1, 1],
      [1, 1],
    ]);
    expect([...monoFromInterleaved(buf, 4, 2)]).toEqual([0.5, 0.5]);
  });

  // The caller hands in only the whole frames; the rest waits for the next chunk.
  it("reads only the frames it was asked for, leaving a partial one alone", () => {
    const buf = Buffer.concat([
      interleave([[1], [1]]),
      Buffer.from([0x00, 0x00]),
    ]);
    expect([...monoFromInterleaved(buf, 2, 1)]).toEqual([1]);
  });
});
