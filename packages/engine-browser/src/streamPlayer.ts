// streamPlayer.ts — the policy half of listening to the engine: decode each binary frame,
// notice what the sender dropped, measure arrival jitter and clock drift, and hand the
// samples to a sink. Deliberately knows nothing about Web Audio — the sink is an interface,
// so all of this is testable without an AudioContext. See docs/streaming.md.

import {
  decodeStreamFrame,
  type StreamFrame,
  seqGap,
} from "@studio/engine-protocol/stream";

/** Where decoded samples go. The real one drives an AudioWorklet; tests use a fake. */
export interface StreamSink {
  /** Interleaved float32, `frames * channels` long. */
  push(samples: Float32Array): void;
  /** Throw away what is buffered and re-cushion — after a gap, or a format change. */
  reset(): void;
}

export interface StreamStats {
  /** Frames that arrived and decoded. */
  frames: number;
  /** Samples per channel handed to the sink — the honest "how much audio" number. */
  framesOfAudio: number;
  /** Frames the SENDER dropped, counted from the sequence numbers. */
  dropped: number;
  /** Binary messages that were not a frame we could read. */
  rejected: number;
  /** Times the stream's format changed under us (a device or rate switch). */
  formatChanges: number;
  /** The format currently arriving, or null before the first frame. */
  format: { channels: number; sampleRate: number } | null;
  /**
   * Arrival jitter, ms: how much later or earlier a frame landed than its own capture
   * clock said it should. The mean is meaningless (the two machines' epochs are
   * unrelated); the SPREAD is the number that decides how deep a jitter buffer must be.
   */
  jitterMs: { min: number; max: number; last: number };
  /**
   * Clock drift, ms per minute, positive when the engine produces faster than this
   * browser consumes. Estimated from capture-time against arrival-time over the whole
   * session, so it needs a minute or two before it means anything — and it is THE number
   * that decides whether resampling is needed or whether a cushion is enough.
   */
  driftMsPerMin: number | null;
}

const emptyStats = (): StreamStats => ({
  frames: 0,
  framesOfAudio: 0,
  dropped: 0,
  rejected: 0,
  formatChanges: 0,
  format: null,
  jitterMs: { min: 0, max: 0, last: 0 },
  driftMsPerMin: null,
});

/**
 * Feed this whatever binary arrives on the engine socket.
 *
 * It is safe to hand it anything: a message that is not one of ours is counted and
 * dropped, never played. The one thing it does NOT do is correct for drift — that is the
 * decision this class exists to inform, and a resampler written before the measurement
 * would be a guess wearing a number.
 */
export class StreamPlayer {
  private sink: StreamSink;
  private now: () => number;
  private stats = emptyStats();
  private lastSeq: number | null = null;
  // The first frame's clocks, as the origin both drift and jitter are measured against.
  private originCapture = 0;
  private originArrival = 0;

  constructor(sink: StreamSink, now: () => number = () => performance.now()) {
    this.sink = sink;
    this.now = now;
  }

  /** @returns the frame, or null when the bytes were not one. */
  handle(data: ArrayBuffer): StreamFrame | null {
    const frame = decodeStreamFrame(data);
    if (!frame) {
      this.stats.rejected++;
      return null;
    }
    const arrival = this.now();

    // A format change is not a glitch to smooth over: 44.1 kHz material played at 48 kHz
    // is a pitch shift, and a channel count change would interleave wrongly. Flush and
    // let the host rebuild its context at the new rate.
    const f = this.stats.format;
    if (
      f === null ||
      f.channels !== frame.channels ||
      f.sampleRate !== frame.sampleRate
    ) {
      if (f !== null) this.stats.formatChanges++;
      this.stats.format = {
        channels: frame.channels,
        sampleRate: frame.sampleRate,
      };
      this.resetClocks(frame.captureMs, arrival);
      this.sink.reset();
    } else if (this.lastSeq !== null) {
      const gap = seqGap(this.lastSeq, frame.seq);
      if (gap > 0) {
        // The sender dropped under backpressure. Re-cushion rather than butt-join across
        // the hole: the samples on either side are unrelated, and splicing them clicks.
        this.stats.dropped += gap;
        this.sink.reset();
        this.resetClocks(frame.captureMs, arrival);
      }
    }

    this.measure(frame.captureMs, arrival);
    this.lastSeq = frame.seq;
    this.stats.frames++;
    this.stats.framesOfAudio += frame.frames;
    this.sink.push(frame.samples);
    return frame;
  }

  private resetClocks(captureMs: number, arrival: number): void {
    this.originCapture = captureMs;
    this.originArrival = arrival;
    this.stats.jitterMs = { min: 0, max: 0, last: 0 };
  }

  private measure(captureMs: number, arrival: number): void {
    // Both clocks measured from the same first frame, so the unknowable offset between the
    // two machines cancels and what is left is transport jitter plus drift.
    const elapsedCapture = captureMs - this.originCapture;
    const elapsedArrival = arrival - this.originArrival;
    const delta = elapsedArrival - elapsedCapture;
    const j = this.stats.jitterMs;
    j.last = delta;
    if (this.stats.frames === 0) {
      j.min = delta;
      j.max = delta;
    } else {
      if (delta < j.min) j.min = delta;
      if (delta > j.max) j.max = delta;
    }
    // Below a minute the slope is jitter, not drift, and reporting it would invite acting
    // on noise. Null says "not known yet", which is different from zero.
    this.stats.driftMsPerMin =
      elapsedCapture >= 60_000 ? (delta / elapsedCapture) * 60_000 : null;
  }

  snapshot(): StreamStats {
    return {
      ...this.stats,
      format: this.stats.format ? { ...this.stats.format } : null,
      jitterMs: { ...this.stats.jitterMs },
    };
  }

  reset(): void {
    this.stats = emptyStats();
    this.lastSeq = null;
    this.sink.reset();
  }
}
