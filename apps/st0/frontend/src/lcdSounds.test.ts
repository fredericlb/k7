// What a screen's `lcd.sound` decodes: a WAV at its own length, channels averaged — a wavetable frame
// stays 2048 samples — and the paths a ref is looked for at, in the compile's order.

import { describe, expect, it } from "vitest";
import { decodeWav, soundPaths, touchesSounds } from "./lcdSounds";

function wav16(samples: number[], channels = 1): ArrayBuffer {
  const data = samples.length * 2;
  const b = new DataView(new ArrayBuffer(44 + data));
  const tag = (o: number, s: string) =>
    [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  b.setUint32(4, 36 + data, true);
  tag(8, "WAVEfmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, channels, true);
  b.setUint32(24, 48000, true);
  b.setUint32(28, 48000 * 2 * channels, true);
  b.setUint16(32, 2 * channels, true);
  b.setUint16(34, 16, true);
  tag(36, "data");
  b.setUint32(40, data, true);
  samples.forEach((s, i) =>
    b.setInt16(44 + i * 2, Math.round(s * 32767), true),
  );
  return b.buffer;
}

describe("decodeWav", () => {
  it("keeps the file's own length, and averages a stereo pair", () => {
    expect(decodeWav(wav16(new Array(2048).fill(0.5)))?.length).toBe(2048);
    const stereo = decodeWav(wav16([1, 0, 1, 0], 2));
    expect(stereo?.length).toBe(2);
    expect(stereo?.[0]).toBeCloseTo(0.5, 3);
  });

  it("answers null for what is not a WAV", () => {
    expect(decodeWav(new ArrayBuffer(8))).toBeNull();
  });
});

describe("soundPaths", () => {
  it("tries a library's wavetables/ then samples/, and the open project for @project", () => {
    expect(soundPaths("@st0/akwf/x.wav", "a.st0")).toEqual([
      "_libraries/st0/wavetables/akwf/x.wav",
      "_libraries/st0/samples/akwf/x.wav",
    ]);
    expect(soundPaths("@project/t.wav", "a.st0")).toEqual([
      "a.st0/wavetables/t.wav",
      "a.st0/samples/t.wav",
    ]);
    expect(soundPaths("wavetables/t.wav", null)).toEqual([]);
  });
});

describe("touchesSounds", () => {
  // A re-rendered sample must be drawn from the new file, and a knob write must not empty the cache.
  it("is true for a sample or a wavetable, and when nobody said what changed", () => {
    expect(touchesSounds([{ path: "samples/kick.wav" }])).toBe(true);
    expect(touchesSounds([{ path: "modules/synth/wavetables/a.wav" }])).toBe(
      true,
    );
    expect(touchesSounds(null)).toBe(true);
  });
  it("is false for a graph, a clip or a module file", () => {
    expect(
      touchesSounds([{ path: "graph.yaml" }, { path: "clips/a.yaml" }]),
    ).toBe(false);
  });
});
