// decode.ts — an audio file to interleaved f32 frames, through the ENGINE's `--decode` where one is
// at hand and through ffmpeg otherwise, plus the two readings made from them: JUCE's mono sum and
// the stream facts the envelope needs. The frame count comes from the DECODE rather than from a
// header, because a bucket boundary is arithmetic on it. See docs/analysis.md.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";

/** ffmpeg is optional everywhere else in this repo; here it is the decoder when no engine is. */
export class NoFfmpegError extends Error {
  constructor(bin: string) {
    super(
      `${bin} is not installed — analysing audio without an engine decodes it with ffmpeg. Install it, or let the engine's machine do the analysis.`,
    );
    this.name = "NoFfmpegError";
  }
}

/** Where a decode comes from: the engine binary when there is one, ffmpeg when `engineBin` is null. */
export interface DecodeOptions {
  engineBin?: string | null;
  /** Kills the decoder, so it lets go of the file — Windows cannot rename a folder a reader holds open. */
  signal?: AbortSignal;
}

export interface StreamFacts {
  sampleRate: number;
  /** What the FILE has, reported as-is. */
  channels: number;
  frames: number;
}

export interface DecodedAudio extends StreamFacts {
  /** Mono, in decode order and in chunks, so nothing copies a long file into one buffer. */
  mono: Float32Array[];
}

/** Whole interleaved frames, `channels` floats each; the buffer is only valid during the call. */
type OnFrames = (
  samples: Float32Array,
  channels: number,
  frames: number,
) => void;

/** The stream's own rate and channel count — ffmpeg's frames carry no header, so ffprobe is asked first. */
async function probe(source: string): Promise<Omit<StreamFacts, "frames">> {
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

/** The engine's header line: `{"sampleRate":…,"channels":…,"frames":…}`. */
function parseHeader(line: string): Omit<StreamFacts, "frames"> {
  const h = JSON.parse(line) as Partial<StreamFacts>;
  if (!(Number(h.channels) > 0))
    throw new Error(`unreadable decode header: ${line}`);
  return {
    sampleRate: Number(h.sampleRate) || 48000,
    channels: Number(h.channels),
  };
}

/** A float view of whole frames, copied only when the bytes do not sit on a 4-byte boundary. */
function floats(buf: Buffer, count: number): Float32Array {
  if (buf.byteOffset % 4 === 0)
    return new Float32Array(buf.buffer, buf.byteOffset, count);
  const copy = new Uint8Array(count * 4);
  copy.set(buf.subarray(0, count * 4));
  return new Float32Array(copy.buffer);
}

/** Read a decoder's stdout as whole frames; `known` is the header when it does not travel in the stream. */
function pump(
  child: ChildProcessWithoutNullStreams,
  bin: string,
  source: string,
  known: Omit<StreamFacts, "frames"> | null,
  onFrames: OnFrames,
  signal: AbortSignal | undefined,
): Promise<StreamFacts> {
  return new Promise((resolve, reject) => {
    let head = known;
    let carry = Buffer.alloc(0);
    let frames = 0;
    let err = "";
    let failed: Error | null = null;
    const onAbort = (): void => {
      failed = new Error(`decoding ${source} was aborted`);
      child.kill();
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      if (failed) return;
      let buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      try {
        if (!head) {
          const nl = buf.indexOf(0x0a);
          if (nl < 0) {
            carry = Buffer.from(buf);
            return;
          }
          head = parseHeader(buf.subarray(0, nl).toString("utf8"));
          buf = buf.subarray(nl + 1);
        }
        // A frame is `channels` floats and a chunk boundary falls anywhere, so a partial one waits here.
        const frameBytes = head.channels * 4;
        const whole = Math.floor(buf.length / frameBytes);
        // Copied, not sliced: the leftover must outlive a chunk Node is free to reuse.
        carry = Buffer.from(buf.subarray(whole * frameBytes));
        if (!whole) return;
        onFrames(floats(buf, whole * head.channels), head.channels, whole);
        frames += whole;
      } catch (e) {
        failed = e as Error;
        child.kill();
      }
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", onAbort);
      reject(
        e.code === "ENOENT" && bin === FFMPEG ? new NoFfmpegError(FFMPEG) : e,
      );
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (failed) return reject(failed);
      if (code !== 0 || !head)
        return reject(
          new Error(
            err.trim() || `${bin} could not decode ${source} (${code})`,
          ),
        );
      resolve({ ...head, frames });
    });
  });
}

/** Decode at the file's OWN rate, every channel, handing whole frames to `onFrames` as they arrive. */
export async function decodeFrames(
  source: string,
  onFrames: OnFrames,
  { engineBin = null, signal }: DecodeOptions = {},
): Promise<StreamFacts> {
  if (engineBin)
    return pump(
      spawn(engineBin, ["--decode", source]),
      engineBin,
      source,
      null,
      onFrames,
      signal,
    );
  const facts = await probe(source);
  // No `-ar` and no `-ac`: resampling moves every onset, and ffmpeg's downmix weights a centre channel.
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
  return pump(child, FFMPEG, source, facts, onFrames, signal);
}

/** JUCE's mono sum over interleaved frames: the first one or two channels averaged, never a downmix. */
export function monoFromInterleaved(
  samples: Float32Array,
  channels: number,
  frames: number,
): Float32Array {
  const useCh = Math.min(channels, 2);
  const block = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < useCh; c++) sum += samples[f * channels + c];
    block[f] = sum / useCh;
  }
  return block;
}

/** The whole file as mono chunks, which is what the envelope is built from. */
export async function decodeMono(
  source: string,
  options: DecodeOptions = {},
): Promise<DecodedAudio> {
  const mono: Float32Array[] = [];
  const facts = await decodeFrames(
    source,
    (samples, channels, frames) =>
      mono.push(monoFromInterleaved(samples, channels, frames)),
    options,
  );
  return { ...facts, mono };
}
