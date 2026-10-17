// streamSink.ts — the Web Audio half: an AudioWorklet whose processor holds a preallocated
// ring and copies out of it, plus the Blob-URL loading that lets a source-only package ship
// a worklet with no build step in any consuming app. The POLICY is in streamPlayer.ts; this
// is deliberately as dumb as an audio thread deserves. See docs/streaming.md.

import type { StreamSink } from "./streamPlayer";

/** The processor, as a source string for a Blob URL, allocating nothing and blocking on nothing — see docs/streaming.md. */
export const PROCESSOR_SOURCE = `
class StudioStreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.channels = o.channels || 2;
    this.capacity = o.capacity || 96000;
    this.startFrames = o.startFrames || 7200;
    // The latency cap, off at 0: a depth held above maxFrames for holdFrames is cut back to startFrames.
    this.maxFrames = o.maxFrames || 0;
    this.holdFrames = o.holdFrames || 24000;
    this.over = 0;
    this.minOver = 0;
    this.ring = [];
    for (let c = 0; c < this.channels; c++)
      this.ring.push(new Float32Array(this.capacity));
    // Monotonic frame counters, never wrapped: at 48 kHz a double stays exact for millennia.
    this.w = 0;
    this.r = 0;
    this.playing = false;
    this.underruns = 0;
    this.overruns = 0;
    this.skips = 0;
    this.blocks = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    if (msg && msg.reset) {
      this.r = this.w;
      this.playing = false;
      this.over = 0;
      return;
    }
    const s = msg;
    if (!s || !s.length) return;
    const n = (s.length / this.channels) | 0;
    // A listener that fell behind wants to catch up to LIVE: drop the oldest frames rather than refuse the newest.
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

    // Hold silence until the cushion is there: starting on the first sample underruns on the very next block for any jitter at all.
    if (!this.playing) {
      if (avail < this.startFrames) return this.report(avail, true);
      this.playing = true;
    }

    if (avail < n) {
      // SILENCE, not a repeat of the last block: a repeat sounds smoother and hides the fault this exercise exists to measure.
      this.underruns++;
      this.playing = false;
      this.over = 0;
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return this.report(avail, true);
    }

    // A backlog that never drains is latency kept for good; the MINIMUM over the hold is what is surely excess, not a jitter peak.
    if (this.maxFrames > 0 && avail > this.maxFrames) {
      this.minOver = this.over === 0 ? avail : Math.min(this.minOver, avail);
      this.over += n;
      if (this.over >= this.holdFrames) {
        this.over = 0;
        return this.skip(out, n, avail, this.minOver - this.startFrames);
      }
    } else this.over = 0;

    for (let i = 0; i < n; i++) {
      const at = (this.r + i) % this.capacity;
      for (let c = 0; c < out.length; c++)
        out[c][i] = this.ring[c < this.channels ? c : this.channels - 1][at];
    }
    this.r += n;
    return this.report(avail - n, false);
  }

  // One block crossfaded from where playback was to drop frames later, so the jump is a blend rather than a click.
  skip(out, n, avail, drop) {
    for (let i = 0; i < n; i++) {
      const g = (i + 0.5) / n;
      const from = (this.r + i) % this.capacity;
      const to = (this.r + drop + i) % this.capacity;
      for (let c = 0; c < out.length; c++) {
        const ch = this.ring[c < this.channels ? c : this.channels - 1];
        out[c][i] = ch[from] * (1 - g) + ch[to] * g;
      }
    }
    this.r += drop + n;
    this.skips++;
    return this.report(avail - drop - n, true);
  }

  // ~7 times a second, not per block: postMessage allocates, and the audio thread pays.
  report(depth, force) {
    if (++this.blocks % 50 === 0 || force)
      this.port.postMessage({
        depth: depth,
        underruns: this.underruns,
        overruns: this.overruns,
        skips: this.skips,
      });
    return true;
  }
}
registerProcessor("studio-stream", StudioStreamProcessor);
`;

export interface SinkStats {
  /** Frames of audio waiting to be played — the live latency, and where drift shows up. */
  depth: number;
  underruns: number;
  overruns: number;
  /** Times the latency cap cut a backlog back to the cushion. */
  skips: number;
}

export interface WorkletSinkOptions {
  channels: number;
  /** Ring size in frames. Default ~2 s at 48 kHz: big enough to ride out a stall. */
  capacity?: number;
  /** The cushion, in frames, before playback starts — 7200, i.e. 150 ms at 48 kHz, and the measurement is in docs/streaming.md. */
  startFrames?: number;
  /** The latency cap, in frames: a depth above it for `holdFrames` is cut back to `startFrames`. Unset is off — a recording must never skip. */
  maxFrames?: number;
  /** How long, in played frames, the depth must stay above `maxFrames` first. Default 24000, half a second at 48 kHz. */
  holdFrames?: number;
}

/** Build the sink for a context whose sampleRate ALREADY matches the stream's: it does not resample, and a mismatch is a pitch shift. */
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

  const node = new AudioWorkletNode(ctx, "studio-stream", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [opts.channels],
    processorOptions: {
      channels: opts.channels,
      capacity: opts.capacity ?? 96000,
      startFrames: opts.startFrames ?? 7200,
      maxFrames: opts.maxFrames ?? 0,
      holdFrames: opts.holdFrames ?? 24000,
    },
  });

  let stats: SinkStats = { depth: 0, underruns: 0, overruns: 0, skips: 0 };
  node.port.onmessage = (e) => {
    stats = e.data as SinkStats;
  };

  return {
    node,
    push(samples: Float32Array, owned = false) {
      // The message's own buffer, header and all, when nobody else reads it; otherwise a copy, so another listener keeps its bytes.
      const out = owned ? samples : samples.slice();
      node.port.postMessage(out, [out.buffer]);
    },
    reset() {
      node.port.postMessage({ reset: true });
    },
    stats: () => stats,
  };
}
