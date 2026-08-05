// separateAudio.ts — the arithmetic a stem separation needs, with no model and no disk in it:
// how a long file is cut into the fixed-size windows the model accepts, how the overlapping
// results are folded back into one signal, and what a float WAV looks like on disk.
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
export const OVERLAP = 0.25;

/** …so a window starts this far after the previous one. */
export const HOP = Math.round(SEGMENT * (1 - OVERLAP));

/** The four sources the model returns, IN THE ORDER it returns them. The output tensor is
 *  `[1, 4, 2, N]` and nothing in it says which index is which — this list is that knowledge,
 *  and getting it wrong silently swaps two stems. */
export const STEMS = ["drums", "bass", "other", "vocals"] as const;
export type Stem = (typeof STEMS)[number];

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

/**
 * A 32-bit float WAV, header and all.
 *
 * Float rather than 16-bit because a stem is not a deliverable: it goes back through a chain,
 * and rounding the model's output on the way out would be a loss taken for no one's benefit.
 * Written by hand because a 44-byte header is smaller than the argument for a dependency.
 */
export function wavFloat32(
  channels: Float32Array[],
  sampleRate = SAMPLE_RATE,
): Buffer {
  const frames = channels[0]?.length ?? 0;
  const n = channels.length;
  const dataBytes = frames * n * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM-style fmt chunk length
  buf.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
  buf.writeUInt16LE(n, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * n * 4, 28); // byte rate
  buf.writeUInt16LE(n * 4, 32); // block align
  buf.writeUInt16LE(32, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < n; c++) {
      buf.writeFloatLE(channels[c][i], at);
      at += 4;
    }
  return buf;
}
