// separateAudio.ts — the arithmetic a stem separation needs, with no model and no disk in it:
// how a long file is cut into the fixed-size windows the model accepts, how the overlapping
// results are folded back into one signal, and what a 24-bit WAV looks like on disk.
// Kept apart from separate.ts so all of it is testable without ONNX Runtime installed.
// See docs/stemSplit.md.

/** HT-Demucs is trained at 44.1 kHz stereo, and the exported graph has it baked in. */
export const SAMPLE_RATE = 44100;
export const CHANNELS = 2;

/** The model's input is a FIXED `[1, 2, 343980]` — 7.8 s. Not a hint; the graph will not
 *  accept another length, which is why everything here is about reaching exactly it. */
export const SEGMENT = 343980;

/** How much of each window repeats the one before. Demucs' own default; the overlap is what
 *  stops a seam being audible every 7.8 seconds. */
const OVERLAP = 0.25;

/** …so a window starts this far after the previous one. */
export const HOP = Math.round(SEGMENT * (1 - OVERLAP));

// The four sources the model returns, IN THE ORDER it returns them. `@studio/song`'s now: a set's
// graph declares a lane per stem and the desk loads a clip per lane, and neither of those can
// import this file. Imported AND re-exported — every caller here already looks for the word in
// this module, and the code below counts on it too.
import { STEMS } from "@studio/song-schema/stems";

export { STEMS };

/**
 * Where each window starts.
 *
 * The last one is pulled BACK to end at the file's end rather than running past it, so the tail
 * is covered by real audio instead of by padding. A file shorter than one window gets a single
 * window at 0, which the caller pads — there is nothing to pull back to.
 */
export function windowStarts(length: number): number[] {
  if (length <= SEGMENT) return [0];
  const starts: number[] = [];
  for (let at = 0; at + SEGMENT < length; at += HOP) starts.push(at);
  starts.push(length - SEGMENT);
  return starts;
}

/**
 * A triangular weight over one window: 0 at the edges, 1 in the middle.
 *
 * This is what makes the overlap a crossfade rather than a seam. Each output sample is the
 * weighted mean of every window covering it, so a sample at the edge of one window — where the
 * model had the least context — is dominated by the window that saw it in the middle.
 *
 * The ends are nudged off zero: a sample covered by exactly one window (the very first and
 * last of a file) would otherwise divide by a zero weight and come out as silence or NaN.
 */
export function triangle(n: number = SEGMENT): Float32Array {
  const w = new Float32Array(n);
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++)
    w[i] = Math.max(1 / n, 1 - Math.abs(i - half) / half);
  return w;
}

/**
 * The accumulator that folds overlapping windows into one signal.
 *
 * Sum of (weight × sample) over the top, sum of weight underneath, divided at the end — the
 * standard overlap-add. Held as two flat buffers per stem rather than a list of windows,
 * because a five-minute song is 13 million samples per channel and keeping every window alive
 * would be several gigabytes.
 */
export class OverlapAdd {
  private readonly acc: Float32Array[][]; // [stem][channel]
  private readonly weight: Float32Array; // shared by every stem and channel
  private readonly win = triangle();

  constructor(
    private readonly length: number,
    stems: number = STEMS.length,
  ) {
    this.acc = Array.from({ length: stems }, () =>
      Array.from({ length: CHANNELS }, () => new Float32Array(length)),
    );
    this.weight = new Float32Array(length);
  }

  /** Fold one window's output in. `at` is where the window starts in the whole signal. */
  add(at: number, stem: number, channel: number, samples: Float32Array): void {
    const dst = this.acc[stem][channel];
    const n = Math.min(samples.length, this.length - at);
    for (let i = 0; i < n; i++) dst[at + i] += samples[i] * this.win[i];
  }

  /** The weight ledger is per POSITION, not per stem or channel — every stem sees the same
   *  windows — so it is counted once, after a window's stems have all been added. */
  countWindow(at: number): void {
    const n = Math.min(SEGMENT, this.length - at);
    for (let i = 0; i < n; i++) this.weight[at + i] += this.win[i];
  }

  /** Divide through, giving one stem's channels. Safe to call once per stem. */
  finish(stem: number): Float32Array[] {
    return this.acc[stem].map((ch) => {
      const out = new Float32Array(this.length);
      for (let i = 0; i < this.length; i++) {
        const w = this.weight[i];
        out[i] = w > 0 ? ch[i] / w : 0;
      }
      return out;
    });
  }
}

/** Interleaved f32 (what ffmpeg writes) → one buffer per channel (what the model wants). */
export function deinterleave(
  pcm: Float32Array,
  channels = CHANNELS,
): Float32Array[] {
  const frames = Math.floor(pcm.length / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) out[c][i] = pcm[i * channels + c];
  return out;
}

/** Bytes a 24-bit sample takes, spelled once — every size below is a multiple of it. */
const BYTES = 3;

/** The largest magnitude a 24-bit sample can carry, and what ±1.0 maps onto. */
const FULL_SCALE = 0x7fffff;

/** One sample, three bytes, little-endian two's complement — Buffer has no writeInt24LE. */
function write24(buf: Buffer, at: number, sample: number): void {
  const n = Math.max(
    -0x800000,
    Math.min(FULL_SCALE, Math.round(sample * FULL_SCALE)),
  );
  const u = n < 0 ? n + 0x1000000 : n;
  buf[at] = u & 0xff;
  buf[at + 1] = (u >> 8) & 0xff;
  buf[at + 2] = (u >> 16) & 0xff;
}

/**
 * The loudest sample across every channel. What tells the caller a stem had to be CLAMPED.
 *
 * The model is under no obligation to stay inside ±1 — it is not reconstructing the mix, it is
 * guessing at one instrument — and a float file carried an overshoot where an integer one cannot.
 * So the overshoot is measured and said out loud rather than discovered as a click.
 */
export function peakOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels)
    for (const v of ch) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  return peak;
}

/**
 * A 24-bit PCM WAV, header and all.
 *
 * **24-bit integer rather than float, because a stem's consumer is a DECK.** Tracktion reads
 * WAV, AIFF and its own float format straight off the disk and decodes everything else into a
 * cached proxy first (`needsCachedProxy`, `tracktion_AudioFile.cpp`) — so a compressed stem
 * would trade a quarter of the volume for five decodes at the moment somebody puts a record on,
 * which is the worst moment there is. Among the formats that avoid that, 24 bits is the small
 * one: a quarter off what float32 wrote, against a quantisation floor at −144 dBFS that reaches
 * the mix only in proportion to how much of the stem is being subtracted.
 *
 * The old comment here said float was right because "a stem is not a deliverable: it goes back
 * through a chain". That was true when a chain was the only thing downstream, and stopped being
 * true when the desk grew its four knobs (packages/ui-turntables/docs/stems.md).
 *
 * Not dithered. Truncation distortion at 24 bits sits below the noise of every converter this
 * will ever come out of, and dither would put a floor there deliberately instead.
 *
 * Written by hand because a 44-byte header is smaller than the argument for a dependency.
 */
export function wavPcm24(
  channels: Float32Array[],
  sampleRate = SAMPLE_RATE,
): Buffer {
  const frames = channels[0]?.length ?? 0;
  const n = channels.length;
  const dataBytes = frames * n * BYTES;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM-style fmt chunk length
  buf.writeUInt16LE(1, 20); // WAVE_FORMAT_PCM
  buf.writeUInt16LE(n, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * n * BYTES, 28); // byte rate
  buf.writeUInt16LE(n * BYTES, 32); // block align
  buf.writeUInt16LE(24, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < n; c++) {
      write24(buf, at, channels[c][i]);
      at += BYTES;
    }
  return buf;
}
