// The stream sweep writes a same-named Opus copy beside every FLAC, remakes a stale one and removes a legacy MP3 — ../../docs/media/derivedStream.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { transcode } from "@studio/audio-analysis/transcode";
import { ensureLayout } from "@studio/mediatek/layout";
import { scanFamily } from "@studio/mediatek/scan";
import { removeLibrary } from "@studio/mediatek/testLibrary";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyIsFresh, ensureStreamCopy } from "./streamCopy.ts";
import { pass, streamSweepState } from "./streamSweep.ts";

/** A third of a second of sine, as a real FLAC made by the same WebAssembly build. */
async function makeFlac(abs: string): Promise<void> {
  mkdirSync(dirname(abs), { recursive: true });
  const rate = 44_100;
  const frames = Math.round(rate * 0.3);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + frames * 2, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(frames * 2, 40);
  for (let f = 0; f < frames; f++)
    wav.writeInt16LE(Math.round(8000 * Math.sin(f / 20)), 44 + f * 2);
  const src = `${abs}.src.wav`;
  writeFileSync(src, wav);
  await transcode([{ source: src }], abs, { kind: "flac", bits: 16 });
  rmSync(src);
}

const EBML = [0x1a, 0x45, 0xdf, 0xa3];

describe("the stream sweep", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "k7-stream-"));
    process.env.STUDIO_MEDIATEK = root;
    ensureLayout();
  });
  afterEach(async () => {
    delete process.env.STUDIO_MEDIATEK;
    await removeLibrary(root);
  });

  it("puts a same-named WebM beside every FLAC, and lists none of them", async () => {
    await makeFlac(join(root, "songs/A/B/C/original.flac"));
    await makeFlac(join(root, "samples/audio/pack/kick.flac"));
    await pass();
    const copy = join(root, "songs/A/B/C/original.webm");
    expect([...readFileSync(copy).subarray(0, 4)]).toEqual(EBML);
    expect(existsSync(join(root, "samples/audio/pack/kick.webm"))).toBe(true);
    // No half-written `.part` left behind, dot-prefixed or not.
    expect(
      readdirSync(join(root, "songs/A/B/C")).filter((f) => f.endsWith(".part")),
    ).toEqual([]);
    expect(streamSweepState().made).toBeGreaterThanOrEqual(2);
    expect((await scanFamily("songs"))[0]?.meta?.master).toBe("original.flac");
    expect((await scanFamily("samples")).map((e) => e.name)).toEqual([
      "kick.flac",
    ]);
  });

  it("remakes the copy of a FLAC replaced since", async () => {
    const flac = join(root, "samples/audio/pack/kick.flac");
    await makeFlac(flac);
    await pass();
    expect(copyIsFresh(flac)).toBe(true);
    // The copy is now older than its FLAC, as after an upload replaced the FLAC.
    const earlier = new Date(Date.now() - 60_000);
    utimesSync(join(root, "samples/audio/pack/kick.webm"), earlier, earlier);
    // A second back, not now: a stamp rounded up to the millisecond could sit after an encode that quick.
    const replaced = new Date(Date.now() - 1000);
    utimesSync(flac, replaced, replaced);
    expect(copyIsFresh(flac)).toBe(false);
    await pass();
    expect(copyIsFresh(flac)).toBe(true);
    expect(
      statSync(join(root, "samples/audio/pack/kick.webm")).size,
    ).toBeGreaterThan(0);
  });

  it("removes the MP3 an older backend derived", async () => {
    const flac = join(root, "samples/audio/pack/hat.flac");
    await makeFlac(flac);
    writeFileSync(join(root, "samples/audio/pack/hat.mp3"), "legacy");
    await pass();
    expect(existsSync(join(root, "samples/audio/pack/hat.mp3"))).toBe(false);
    expect(copyIsFresh(flac)).toBe(true);
  });

  it("runs one encode for requests that ask at once", async () => {
    const flac = join(root, "samples/audio/pack/snare.flac");
    await makeFlac(flac);
    const asks = [
      ensureStreamCopy(flac),
      ensureStreamCopy(flac),
      ensureStreamCopy(flac),
    ];
    expect(new Set(asks).size).toBe(1);
    await Promise.all(asks);
    expect(copyIsFresh(flac)).toBe(true);
  });

  it("leaves no copy behind a FLAC removed during its encode", async () => {
    const flac = join(root, "samples/audio/pack/gone.flac");
    await makeFlac(flac);
    const asked = ensureStreamCopy(flac);
    rmSync(flac);
    await expect(asked).rejects.toThrow();
    expect(existsSync(join(root, "samples/audio/pack/gone.webm"))).toBe(false);
  });
});
