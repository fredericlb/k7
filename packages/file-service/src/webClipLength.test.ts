// The extent a clip DRAWS at, filled in on the way to the browser.
//
// `length: 0` on a compiled ClipDoc means "to the end of the source" — a duration the compiler
// will not open a wav to learn and the ENGINE fills in from the file it holds. Passed to the
// browser unchanged, nothing can act on it: a browser may not resolve a path on this machine,
// let alone read a header. The timeline then draws ONE BAR, and a three-bar consolidated render
// is drawn as one while playing all of it.
//
// Answered here because this is the only side that can. Nothing is written into the song for it.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrackDoc } from "@studio/song/project";
import { afterEach, describe, expect, it } from "vitest";
import { toWebTracks } from "./webTracks.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A real 48 kHz / 2ch / 24-bit header, answering the length it ACTUALLY wrote in whole frames. */
function wav(seconds: number): { path: string; seconds: number } {
  const dir = mkdtempSync(join(tmpdir(), "weblen-"));
  dirs.push(dir);
  const rate = 48000;
  const frame = 2 * 3;
  const data = Math.round(rate * seconds) * frame;
  const h = Buffer.alloc(44 + data);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * frame, 28);
  h.writeUInt16LE(frame, 32);
  h.writeUInt16LE(24, 34);
  h.write("data", 36);
  h.writeUInt32LE(data, 40);
  const path = join(dir, "r.wav");
  writeFileSync(path, h);
  return { path, seconds: data / frame / rate };
}

const clip = (over: Partial<TrackDoc["clips"][number]> = {}) =>
  ({
    id: "c@0",
    type: "audio",
    name: "c",
    source: "",
    start: 0,
    length: 0,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    loopStart: 0,
    loopEnd: 0,
    notes: [],
    ...over,
  }) as TrackDoc["clips"][number];

const track = (c: TrackDoc["clips"][number]) =>
  ({
    id: "t",
    name: "t",
    clips: [c],
    plugins: [],
  }) as unknown as TrackDoc;

const drawn = (c: TrackDoc["clips"][number], tempo?: number) =>
  toWebTracks([track(c)], tempo)[0].clips[0].length;

// 110 BPM: one beat is 60/110 s, so 6.716938 s is 12.3144 beats — the reference case.
const BEATS = (secs: number, tempo = 110) => (secs * tempo) / 60;

describe("a clip whose document states no extent", () => {
  it("is drawn at its SOURCE's length", () => {
    const w = wav(6.716938); // the reference case: 3.08 bars, drawn as one
    expect(drawn(clip({ source: w.path }), 110)).toBeCloseTo(
      BEATS(w.seconds),
      9,
    );
  });

  it("is measured FROM the in-point, which is where the drawing starts", () => {
    const w = wav(10);
    const c = clip({ source: w.path, sourceFrom: 2 });
    expect(drawn(c, 110)).toBeCloseTo(BEATS(w.seconds - 2), 9);
  });

  it("stays 0 when the file is not there — the old behaviour, unchanged", () => {
    expect(drawn(clip({ source: "C:/nowhere/gone.wav" }), 110)).toBe(0);
  });

  it("stays 0 with no tempo to convert by — Strudel's live orbits have no files", () => {
    expect(drawn(clip({ source: wav(4).path }))).toBe(0);
  });

  it("leaves MIDI alone: its extent is its notes, not a file", () => {
    expect(drawn(clip({ type: "midi", source: "" }), 110)).toBe(0);
  });
});

describe("a clip that DOES state one", () => {
  it("keeps it — a window is the document's business, not the file's", () => {
    // The whole point of the `||`: a stated extent wins, and only the unstated 0 is filled in.
    const c = clip({ source: wav(10).path, length: 4, sourceTo: 2.18 });
    expect(drawn(c, 110)).toBe(4);
  });
});
