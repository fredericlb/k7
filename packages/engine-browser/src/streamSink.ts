// streamSink.ts — the Web Audio half: an AudioWorklet whose processor holds a preallocated
// ring and copies out of it, plus the Blob-URL loading that lets a source-only package ship
// a worklet with no build step in any consuming app. The POLICY is in streamPlayer.ts; this
// is deliberately as dumb as an audio thread deserves. See docs/streaming.md.

import type { StreamSink } from "./streamPlayer";

/**
 * The processor, as source.
 *
 * A string, and a Blob URL, because `addModule` takes a URL and every alternative pushes
 * work onto the apps: `new URL("./x.js", import.meta.url)` needs a bundler that emits the
 * worklet as its own chunk, and these packages are consumed as raw TypeScript with no build
 * step at all. The cost is real and worth naming — nothing type-checks or lints inside this
 * string, so it is kept small enough to read in one screen.
 *
 * Everything in it obeys the audio thread's two rules: allocate nothing, block on nothing.
 * The ring is preallocated at construction; `process` only copies.
 */
const PROCESSOR_SOURCE = `
class LanesStreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.channels = o.channels || 2;
    this.capacity = o.capacity || 96000;
    this.startFrames = o.startFrames || 2400;
    this.ring = [];
    for (let c = 0; c < this.channels; c++)
      this.ring.push(new Float32Array(this.capacity));
    // Monotonic frame counters, never wrapped: at 48 kHz a double stays exact for
    // millennia, so the only modulo is the one that indexes the ring.
    this.w = 0;
    this.r = 0;
    this.playing = false;
    this.underruns = 0;
    this.overruns = 0;
    this.blocks = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    if (msg && msg.reset) {
      this.r = this.w;
      this.playing = false;
      return;
    }
    const s = msg;
    if (!s || !s.length) return;
    const n = (s.length / this.channels) | 0;
    // A listener that fell behind wants to catch up to LIVE, not to replay: drop the
    // oldest frames rather than refuse the newest.
    const free = this.capacity - (this.w - this.r);
    if (n > free) {
      this.r = this.w + n - this.capacity;
      this.overruns++;
    }
    for (let i = 0; i < n; i++) {
      const at = (this.w + i) % this.capacity;
      for (let c = 0; c < this.channels; c++)
        this.ring[c][at] = s[i * this.channels + c];
    }
    this.w += n;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const n = out[0].length;
    const avail = this.w - this.r;

    // Hold silence until the cushion is there. Starting on the first sample would
    // underrun on the very next block for any jitter at all.
    if (!this.playing) {
      if (avail < this.startFrames) return this.report(avail, true);
      this.playing = true;
    }

    if (avail < n) {
      // SILENCE, not a repeat of the last block: a repeat sounds smoother and hides the
      // very fault this whole exercise exists to measure.
      this.underruns++;
      this.playing = false;
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return this.report(avail, true);
    }

    for (let i = 0; i < n; i++) {
      const at = (this.r + i) % this.capacity;
      for (let c = 0; c < out.length; c++)
        out[c][i] = this.ring[c < this.channels ? c : this.channels - 1][at];
    }
    this.r += n;
    return this.report(avail - n, false);
  }

  // ~7 times a second, not per block: postMessage allocates, and the audio thread pays.
  report(depth, force) {
    if (++this.blocks % 50 === 0 || force)
      this.port.postMessage({
        depth: depth,
        underruns: this.underruns,
        overruns: this.overruns,
      });
    return true;
  }
}
registerProcessor("lanes-stream", LanesStreamProcessor);
`;

export interface SinkStats {
  /** Frames of audio waiting to be played — the live latency, and where drift shows up. */
  depth: number;
  underruns: number;
  overruns: number;
}

export interface WorkletSinkOptions {
  channels: number;
  /** Ring size in frames. Default ~2 s at 48 kHz: big enough to ride out a stall. */
  capacity?: number;
  /** The cushion, in frames, before playback starts. Default 50 ms at 48 kHz. */
  startFrames?: number;
}

/**
 * Build the sink for a context whose sampleRate ALREADY matches the stream's.
 *
 * It does not resample, so the caller must construct its `AudioContext` at the rate the
 * first frame reported — `new AudioContext({ sampleRate })`. Playing 44.1 kHz material
 * into a 48 kHz context is a pitch shift, not a glitch, and it would be inaudible as a
 * fault while being obvious as "the engine sounds wrong".
 */
export async function createWorkletSink(
  ctx: AudioContext,
  opts: WorkletSinkOptions,
): Promise<StreamSink & { node: AudioWorkletNode; stats(): SinkStats }> {
  const url = URL.createObjectURL(
    new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }),
  );
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    // The module is compiled by now; holding the URL only leaks it.
    URL.revokeObjectURL(url);
  }

  const node = new AudioWorkletNode(ctx, "lanes-stream", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [opts.channels],
    processorOptions: {
      channels: opts.channels,
      capacity: opts.capacity ?? 96000,
      startFrames: opts.startFrames ?? 2400,
    },
  });

  let stats: SinkStats = { depth: 0, underruns: 0, overruns: 0 };
  node.port.onmessage = (e) => {
    stats = e.data as SinkStats;
  };

  return {
    node,
    push(samples: Float32Array) {
      // A copy, and transferred: the frame's samples are a view onto the socket's buffer,
      // which the next message reuses. Sending the view itself would hand the audio thread
      // memory that is about to change underneath it.
      const copy = samples.slice();
      node.port.postMessage(copy, [copy.buffer]);
    },
    reset() {
      node.port.postMessage({ reset: true });
    },
    stats: () => stats,
  };
}
