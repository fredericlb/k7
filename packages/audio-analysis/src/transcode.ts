// transcode.ts — files re-encoded by the WebAssembly build (rust/src/encode.rs): a cut, a join, a format, with no ffmpeg.
// A reader would get wrong what crosses into the module: no samples — the decoder's block is encoded where it lies (docs/transcode.md).
// The output is written beside `dest` under a dot-name and renamed over it only once finished, so no walk ever counts a half file.

import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { DecodeAbi } from "./decodeWasm.ts";
import { instantiate, wasmModule } from "./native.ts";

/** Frames per decoded block: about 1.4 s at 48 kHz, a few milliseconds of work. */
const BLOCK = 1 << 16;

/** How far before a cut's start a seek lands: Opus needs 80 ms of pre-roll to settle, and a seek may fall short. */
const PRE_ROLL = 0.25;

export type Target =
  /** Opus in WebM, at 48 kHz: `bitrate` bits/s, 128k unless said; one or two channels. */
  | { kind: "opus"; bitrate?: number; channels?: 1 | 2 }
  /** FLAC at the first source's rate, `bits` per sample, 24 unless said. */
  | { kind: "flac"; bits?: 16 | 24 }
  /** 16-bit PCM WAV at `rate`. */
  | { kind: "wav"; rate: number; channels?: number };

/** A file, or `duration` seconds of it from `start`. */
export interface Piece {
  source: string;
  start?: number;
  duration?: number;
}

/** A loudness to bring the result to: integrated LUFS, held under a true-peak ceiling in dBTP. */
export interface Loudness {
  lufs: number;
  truePeak: number;
}

export interface TranscodeOptions {
  loudness?: Loudness;
  signal?: AbortSignal;
  /** Where the output is written until it is finished; a dot-name beside `dest` unless the caller names one to clean up. */
  part?: string;
}

export interface Transcoded {
  frames: number;
  sampleRate: number;
  /** The gain applied, in dB: 0 unless a loudness was asked. */
  gainDb: number;
}

interface EncodeAbi extends DecodeAbi {
  enc_open(
    kind: number,
    inRate: number,
    inChannels: number,
    channels: number,
    param: number,
  ): number;
  enc_reformat(inRate: number, inChannels: number): number;
  enc_push_decoded(from: number, count: number, gain: number): number;
  enc_finish(): number;
  lufs_open(rate: number, channels: number): number;
  lufs_push_decoded(from: number, count: number): number;
  lufs_integrated(): number;
  lufs_true_peak(): number;
}

/** One instance reading whichever source is open and writing one output file. */
class Session {
  readonly abi: EncodeAbi;
  private input = -1;
  output = -1;

  constructor(module: object) {
    let abi: EncodeAbi | null = null;
    const bytes = (ptr: number, len: number) =>
      new Uint8Array((abi as EncodeAbi).memory.buffer, ptr, len);
    abi = instantiate(module, {
      read: (ptr, len, pos) => {
        try {
          return readSync(this.input, bytes(ptr, len), 0, len, pos);
        } catch {
          return -1;
        }
      },
      write: (ptr, len, pos) => {
        try {
          return writeSync(this.output, bytes(ptr, len), 0, len, pos);
        } catch {
          return -1;
        }
      },
    }) as EncodeAbi;
    this.abi = abi;
  }

  error(what: string, source: string): Error {
    const a = this.abi;
    const msg = new TextDecoder().decode(
      new Uint8Array(a.memory.buffer, a.dec_error_ptr(), a.dec_error_len()),
    );
    return new Error(`${what} ${source}: ${msg}`);
  }

  /** Opens `source` in the decoder, closing the one before: its rate and channels. */
  open(source: string): { rate: number; channels: number } {
    this.closeInput();
    this.input = openSync(source, "r");
    const a = this.abi;
    const ext = new TextEncoder().encode(
      extname(source).slice(1).toLowerCase(),
    );
    // The pointer first: allocating may grow the memory, which detaches a buffer taken before.
    const hint = a.dec_hint(ext.length);
    new Uint8Array(a.memory.buffer, hint, ext.length).set(ext);
    if (a.dec_open(fstatSync(this.input).size) < 0)
      throw this.error("cannot open", source);
    return { rate: a.dec_rate(), channels: a.dec_channels() };
  }

  closeInput(): void {
    if (this.input >= 0) closeSync(this.input);
    this.input = -1;
  }
}

/** Every decoded block of `piece` that falls in its range, as `[from, count)` of the block the decoder holds. */
async function eachRange(
  s: Session,
  piece: Piece,
  rate: number,
  signal: AbortSignal | undefined,
  visit: (from: number, count: number) => void,
): Promise<void> {
  const a = s.abi;
  const start = Math.round((piece.start ?? 0) * rate);
  const end =
    piece.duration === undefined
      ? Number.POSITIVE_INFINITY
      : start + Math.round(piece.duration * rate);
  let pos = 0;
  if (start > PRE_ROLL * rate) {
    const at = a.dec_seek(start / rate - PRE_ROLL);
    // A file that cannot seek is decoded from its start, which is slower and as exact.
    if (at >= 0) pos = Math.round(at * rate);
    else s.open(piece.source);
  }
  while (pos < end) {
    if (signal?.aborted)
      throw new Error(`transcoding ${piece.source} was aborted`);
    const n = a.dec_next(BLOCK);
    if (n < 0) throw s.error("cannot decode", piece.source);
    if (n === 0) break;
    const from = Math.max(0, start - pos);
    const to = Math.min(n, end - pos);
    if (to > from) visit(from, to - from);
    pos += n;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** The gain, in dB, that brings `piece` to `target`, never past its true-peak ceiling. */
async function gainFor(
  s: Session,
  piece: Piece,
  target: Loudness,
  signal: AbortSignal | undefined,
): Promise<number> {
  const a = s.abi;
  const { rate, channels } = s.open(piece.source);
  if (a.lufs_open(rate, channels) < 0)
    throw s.error("cannot measure", piece.source);
  await eachRange(s, piece, rate, signal, (from, count) => {
    if (a.lufs_push_decoded(from, count) < 0)
      throw s.error("cannot measure", piece.source);
  });
  const lufs = a.lufs_integrated();
  const peak = a.lufs_true_peak();
  // Silence has no loudness to correct.
  if (!Number.isFinite(lufs)) return 0;
  const gain = target.lufs - lufs;
  return Number.isFinite(peak) ? Math.min(gain, target.truePeak - peak) : gain;
}

const KINDS = { opus: 0, flac: 1, wav: 2 } as const;

/** A dot-name beside `dest`, so no walk of its folder counts the file before it is finished. */
export function partFor(dest: string): string {
  return join(dirname(dest), `.${basename(dest)}.${randomUUID()}.part`);
}

/** Decode `pieces` in order, joined, into `dest` as `target` — on this thread; the pool runs it on a worker (pool.ts). */
export async function transcode(
  pieces: Piece[],
  dest: string,
  target: Target,
  { loudness, signal, part }: TranscodeOptions = {},
): Promise<Transcoded> {
  if (pieces.length === 0) throw new Error("nothing to transcode");
  if (loudness && pieces.length > 1)
    throw new Error("a loudness is brought to one piece, not to a join");
  const module = wasmModule();
  if (!module)
    throw new Error("this runtime has no WebAssembly to transcode with");
  const s = new Session(module);
  const tmp = part ?? partFor(dest);
  try {
    // Measuring decodes every piece once more, which a loudness asks for and nothing else does.
    const gainDb = loudness ? await gainFor(s, pieces[0], loudness, signal) : 0;
    const gain = 10 ** (gainDb / 20);
    s.output = openSync(tmp, "w");
    const a = s.abi;
    let firstRate = 0;
    for (const [i, piece] of pieces.entries()) {
      const { rate, channels } = s.open(piece.source);
      if (i === 0) {
        firstRate = rate;
        const param =
          target.kind === "opus"
            ? (target.bitrate ?? 128_000)
            : target.kind === "flac"
              ? (target.bits ?? 24)
              : target.rate;
        const want = target.kind === "flac" ? 0 : (target.channels ?? 0);
        if (a.enc_open(KINDS[target.kind], rate, channels, want, param) < 0)
          throw s.error("cannot encode", piece.source);
      } else if (a.enc_reformat(rate, channels) < 0)
        throw s.error("cannot join", piece.source);
      await eachRange(s, piece, rate, signal, (from, count) => {
        if (a.enc_push_decoded(from, count, gain) < 0)
          throw s.error("cannot encode", piece.source);
      });
    }
    const frames = a.enc_finish();
    if (frames < 0) throw s.error("cannot finish", dest);
    closeSync(s.output);
    s.output = -1;
    renameSync(tmp, dest);
    const sampleRate =
      target.kind === "opus"
        ? 48_000
        : target.kind === "wav"
          ? target.rate
          : firstRate;
    return { frames, sampleRate, gainDb };
  } finally {
    s.closeInput();
    if (s.output >= 0) closeSync(s.output);
    rmSync(tmp, { force: true });
  }
}
