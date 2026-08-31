// decode.ts — audio file to mono f32 through ffmpeg, plus the stream facts the envelope needs.
// The mono sum is JUCE's, so both producers of a sidecar hear the same signal: the first one or
// two channels averaged, never ffmpeg's own downmix, which weights a centre channel. The frame
// count comes from the DECODE rather than from ffprobe's duration, because a bucket boundary is
// arithmetic on it. See docs/analysis.md.

import { spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";

/** ffmpeg is optional everywhere else in this repo; here it is the whole decoder. */
export class NoFfmpegError extends Error {
  constructor(bin: string) {
    super(
      `${bin} is not installed — analysing audio decodes it with ffmpeg. Install it, or let the engine's machine do the analysis.`,
    );
    this.name = "NoFfmpegError";
  }
}

export interface DecodedAudio {
  sampleRate: number;
  /** What the FILE has, reported as-is; the sum below uses at most the first two. */
  channels: number;
  frames: number;
  /** Mono, in decode order and in chunks, so nothing copies a long file into one buffer. */
  mono: Float32Array[];
}

interface Probe {
  sampleRate: number;
  channels: number;
}

/** The stream's own rate and channel count — asked before decoding, since the sum depends on them. */
async function probe(source: string): Promise<Probe> {
  const out = await run(FFPROBE, [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate,channels",
    "-of",
    "json",
    source,
  ]);
  const stream = (
    JSON.parse(out) as {
      streams?: { sample_rate?: string; channels?: number }[];
    }
  ).streams?.[0];
  if (!stream) throw new Error(`no audio stream in ${source}`);
  return {
    sampleRate: Number(stream.sample_rate) || 48000,
    channels: stream.channels || 1,
  };
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "ENOENT" ? new NoFfmpegError(bin) : e),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(err.trim() || `${bin} failed (${code})`)),
    );
  });
}

/**
 * JUCE's mono sum over an interleaved f32 block: the first one or two channels averaged.
 * Exported because a chunk boundary falls anywhere, and this is where that gets it wrong.
 */
export function monoFromInterleaved(
  buf: Buffer,
  channels: number,
  frames: number,
): Float32Array {
  const useCh = Math.min(channels, 2);
  const block = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < useCh; c++)
      sum += buf.readFloatLE((f * channels + c) * 4);
    block[f] = sum / useCh;
  }
  return block;
}

/** Decode at the file's OWN rate: resampling here would move every onset the engine reports. */
export function decodeMono(source: string): Promise<DecodedAudio> {
  return probe(source).then(
    ({ sampleRate, channels }) =>
      new Promise<DecodedAudio>((resolve, reject) => {
        const child = spawn(FFMPEG, [
          "-v",
          "error",
          "-i",
          source,
          "-map",
          "0:a:0",
          "-f",
          "f32le",
          "-acodec",
          "pcm_f32le",
          "-",
        ]);
        const mono: Float32Array[] = [];
        let frames = 0;
        // A frame is `channels` floats and a chunk boundary falls anywhere, so a partial one waits here.
        let carry = Buffer.alloc(0);
        let err = "";
        const frameBytes = channels * 4;

        child.stdout.on("data", (chunk: Buffer) => {
          const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
          const whole = Math.floor(buf.length / frameBytes);
          // Copied, not sliced: the leftover must outlive a chunk Node is free to reuse.
          carry = Buffer.from(buf.subarray(whole * frameBytes));
          if (!whole) return;
          mono.push(monoFromInterleaved(buf, channels, whole));
          frames += whole;
        });
        child.stderr.on("data", (c: Buffer) => {
          err += c.toString();
        });
        child.on("error", (e: NodeJS.ErrnoException) =>
          reject(e.code === "ENOENT" ? new NoFfmpegError(FFMPEG) : e),
        );
        child.on("close", (code) => {
          if (code !== 0)
            return reject(
              new Error(
                err.trim() || `ffmpeg could not decode ${source} (${code})`,
              ),
            );
          resolve({ sampleRate, channels, frames, mono });
        });
      }),
  );
}
