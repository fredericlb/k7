// The MP3 sweep writes a same-named MP3 beside every FLAC, and remakes a stale one — ../../docs/media/derivedMp3.md.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureLayout } from "@studio/mediatek/layout";
import { scanFamily } from "@studio/mediatek/scan";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mp3SweepState, pass } from "./mp3Sweep.ts";
import { ensureMp3, mp3IsFresh } from "./transcode.ts";

// The real encoder or nothing: a faked ffmpeg would test the fake.
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const hasFfmpeg = spawnSync(FFMPEG, ["-version"]).status === 0;

/** A third of a second of sine, as a real FLAC. */
function makeFlac(abs: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  const r = spawnSync(FFMPEG, [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=d=0.3",
    abs,
  ]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}

describe.skipIf(!hasFfmpeg)("the MP3 sweep", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "k7-mp3-"));
    process.env.STUDIO_MEDIATEK = root;
    ensureLayout();
  });
  afterEach(() => {
    delete process.env.STUDIO_MEDIATEK;
    rmSync(root, { recursive: true, force: true });
  });

  it("puts a same-named MP3 beside every FLAC, and lists none of them", async () => {
    makeFlac(join(root, "songs/A/B/C/original.flac"));
    makeFlac(join(root, "samples/audio/pack/kick.flac"));
    await pass();
    expect(existsSync(join(root, "songs/A/B/C/original.mp3"))).toBe(true);
    expect(existsSync(join(root, "samples/audio/pack/kick.mp3"))).toBe(true);
    // No half-written `.part` left behind, dot-prefixed or not.
    expect(
      readdirSync(join(root, "songs/A/B/C")).filter((f) => f.endsWith(".part")),
    ).toEqual([]);
    expect(mp3SweepState().made).toBeGreaterThanOrEqual(2);
    expect((await scanFamily("songs"))[0]?.meta?.master).toBe("original.flac");
    expect((await scanFamily("samples")).map((e) => e.name)).toEqual([
      "kick.flac",
    ]);
  });

  it("remakes the MP3 of a FLAC replaced since", async () => {
    const flac = join(root, "samples/audio/pack/kick.flac");
    makeFlac(flac);
    await pass();
    expect(mp3IsFresh(flac)).toBe(true);
    // The MP3 is now older than its FLAC, as after an upload replaced the FLAC.
    const earlier = new Date(Date.now() - 60_000);
    utimesSync(join(root, "samples/audio/pack/kick.mp3"), earlier, earlier);
    utimesSync(flac, new Date(), new Date());
    expect(mp3IsFresh(flac)).toBe(false);
    await pass();
    expect(mp3IsFresh(flac)).toBe(true);
    expect(
      statSync(join(root, "samples/audio/pack/kick.mp3")).size,
    ).toBeGreaterThan(0);
  });

  it("runs one ffmpeg for requests that ask at once", async () => {
    const flac = join(root, "samples/audio/pack/snare.flac");
    makeFlac(flac);
    const asks = [ensureMp3(flac), ensureMp3(flac), ensureMp3(flac)];
    expect(new Set(asks).size).toBe(1);
    await Promise.all(asks);
    expect(mp3IsFresh(flac)).toBe(true);
  });

  it("leaves no MP3 behind a FLAC removed during its transcode", async () => {
    const flac = join(root, "samples/audio/pack/gone.flac");
    makeFlac(flac);
    const asked = ensureMp3(flac);
    rmSync(flac);
    await expect(asked).rejects.toThrow();
    expect(existsSync(join(root, "samples/audio/pack/gone.mp3"))).toBe(false);
  });
});
