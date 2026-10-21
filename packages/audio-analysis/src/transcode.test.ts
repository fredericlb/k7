// transcode.test.ts — the WebAssembly encoders: lengths to the frame, a cut where it was asked, a loudness reached, and,
// where ffmpeg is installed, files it reads as what they claim to be.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeWithWasm } from "./decodeWasm.ts";
import { transcode } from "./transcode.ts";

const dir = mkdtempSync(join(tmpdir(), "transcode-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A 16-bit wav: a 220 Hz tone whose level steps every second, so a misplaced cut shows. */
function wav(name: string, rate: number, channels: number, seconds: number) {
  const frames = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + frames * channels * 2);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + frames * channels * 2, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(frames * channels * 2, 40);
  for (let f = 0; f < frames; f++) {
    const level = 0.1 + 0.05 * (Math.floor(f / rate) % 5);
    const v = level * Math.sin((2 * Math.PI * 220 * f) / rate);
    for (let c = 0; c < channels; c++)
      b.writeInt16LE(Math.round(v * 32767), 44 + (f * channels + c) * 2);
  }
  const path = join(dir, name);
  writeFileSync(path, b);
  return path;
}

/** A 16-bit mono wav sweeping 100 Hz to 4 kHz: no two stretches of it alike, so a misplaced cut cannot pass for a placed one. */
function chirp(name: string, seconds: number) {
  const rate = 48_000;
  const frames = rate * seconds;
  const b = Buffer.alloc(44 + frames * 2);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + frames * 2, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(frames * 2, 40);
  const k = (4000 - 100) / seconds;
  for (let f = 0; f < frames; f++) {
    const t = f / rate;
    const v = 0.3 * Math.sin(2 * Math.PI * (100 * t + (k * t * t) / 2));
    b.writeInt16LE(Math.round(v * 32767), 44 + f * 2);
  }
  const path = join(dir, name);
  writeFileSync(path, b);
  return path;
}

async function decode(path: string) {
  const parts: Float32Array[] = [];
  const facts = await decodeWithWasm(path, (s, c, n) =>
    parts.push(s.slice(0, n * c)),
  );
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return { ...facts, samples: all };
}

const ffmpeg = (() => {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** What ffprobe reads of `path`'s audio stream, or null without ffprobe. */
function probe(path: string): Record<string, string> | null {
  if (!ffmpeg) return null;
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_name,sample_rate,channels:format=format_name,duration",
    "-of",
    "default=noprint_wrappers=1",
    path,
  ]).toString();
  return Object.fromEntries(
    out
      .trim()
      .split("\n")
      .map((l) => l.split("=") as [string, string]),
  );
}

describe("transcode", () => {
  const src = wav("source.wav", 44_100, 2, 12);

  it("cuts Opus in WebM to the frame, at the loudness asked", async () => {
    const out = join(dir, "clip.webm");
    const r = await transcode(
      [{ source: src, start: 5, duration: 3 }],
      out,
      { kind: "opus" },
      { loudness: { lufs: -14, truePeak: -1 } },
    );
    expect(r.frames).toBe(3 * 48_000);
    const d = await decode(out);
    expect([d.sampleRate, d.channels, d.frames]).toEqual([48_000, 2, 144_000]);
    // A tone at -14 LUFS would peak past -1 dBTP: the ceiling is what bounds it.
    let peak = 0;
    for (const v of d.samples) peak = Math.max(peak, Math.abs(v));
    expect(20 * Math.log10(peak)).toBeLessThan(-0.5);
    expect(r.gainDb).toBeGreaterThan(0);
    const p = probe(out);
    if (p) {
      expect(p.codec_name).toBe("opus");
      expect(p.format_name).toContain("webm");
      expect(Number(p.duration)).toBeCloseTo(3, 1);
    }
    // Nothing but the output is left in the folder.
    expect(readdirSync(dir).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("joins files of different rates and channel counts", async () => {
    const mono = wav("mono.wav", 22_050, 1, 2);
    const out = join(dir, "joined.webm");
    const r = await transcode([{ source: src }, { source: mono }], out, {
      kind: "opus",
      channels: 2,
    });
    expect(r.frames).toBe(14 * 48_000);
    expect((await decode(out)).frames).toBe(14 * 48_000);
  });

  it("writes FLAC that holds the source's samples", async () => {
    const out = join(dir, "master.flac");
    await transcode([{ source: src }], out, { kind: "flac" });
    const [a, b] = [await decode(src), await decode(out)];
    expect([b.sampleRate, b.channels, b.frames]).toEqual([44_100, 2, a.frames]);
    let worst = 0;
    for (let i = 0; i < a.samples.length; i++)
      worst = Math.max(worst, Math.abs(a.samples[i] - b.samples[i]));
    expect(worst).toBeLessThan(1e-6);
    if (ffmpeg)
      execFileSync("ffmpeg", ["-v", "error", "-i", out, "-f", "null", "-"]);
  });

  it("writes the mono 16 kHz WAV a transcription wants", async () => {
    const out = join(dir, "speech.wav");
    await transcode([{ source: src }], out, {
      kind: "wav",
      rate: 16_000,
      channels: 1,
    });
    const d = await decode(out);
    expect([d.sampleRate, d.channels, d.frames]).toEqual([16_000, 1, 192_000]);
  });

  it("cuts deep into a WebM within a millisecond of where it was asked", async () => {
    const long = join(dir, "session.webm");
    await transcode([{ source: chirp("long.wav", 60) }], long, {
      kind: "opus",
      channels: 1,
    });
    const cut = join(dir, "cut.flac");
    await transcode([{ source: long, start: 45.5, duration: 2 }], cut, {
      kind: "flac",
    });
    const [whole, part] = [await decode(long), await decode(cut)];
    expect(part.frames).toBe(96_000);
    // A chirp lines up at one offset only; WebM states time in milliseconds, so the cut lands within one.
    const at = 45.5 * 48_000;
    let best = { lag: 0, err: Number.POSITIVE_INFINITY };
    for (let lag = -3000; lag <= 3000; lag++) {
      let err = 0;
      for (let i = 12_000; i < 90_000; i += 5)
        err += Math.abs(part.samples[i] - whole.samples[at + i + lag]);
      if (err < best.err) best = { lag, err };
    }
    expect(Math.abs(best.lag)).toBeLessThanOrEqual(48);
  });
});
