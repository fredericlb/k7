import {
  encodeStreamFrame,
  STREAM_CODEC_PCM_F32,
  STREAM_VERSION,
  type StreamFrame,
} from "@studio/engine-protocol/stream";
import { describe, expect, it } from "vitest";
import { StreamPlayer, type StreamSink } from "./streamPlayer";

// A sink that remembers, so what the player DID is inspectable without an AudioContext.
class FakeSink implements StreamSink {
  pushes: Float32Array[] = [];
  resets = 0;
  push(s: Float32Array) {
    this.pushes.push(s);
  }
  reset() {
    this.resets++;
  }
}

// A clock the test drives, so jitter and drift come from numbers we chose rather than from how fast the suite's machine is.
class FakeClock {
  t = 0;
  now = () => this.t;
  at(ms: number) {
    this.t = ms;
    return this;
  }
}

const FRAMES = 480; // 10 ms at 48 kHz — the cadence the engine sender is designed around

function bytes(over: Partial<StreamFrame> = {}): ArrayBuffer {
  const channels = over.channels ?? 2;
  const frames = over.frames ?? FRAMES;
  return encodeStreamFrame({
    version: STREAM_VERSION,
    channels,
    sampleRate: 48000,
    frames,
    seq: 0,
    codec: STREAM_CODEC_PCM_F32,
    captureMs: 0,
    samples: new Float32Array(frames * channels),
    ...over,
  });
}

describe("reading the stream", () => {
  it("hands every frame's samples to the sink", () => {
    const sink = new FakeSink();
    const p = new StreamPlayer(sink, new FakeClock().now);
    p.handle(bytes({ seq: 0, captureMs: 0 }));
    p.handle(bytes({ seq: 1, captureMs: 10 }));
    expect(sink.pushes).toHaveLength(2);
    expect(sink.pushes[0]).toHaveLength(FRAMES * 2);
    expect(p.snapshot().frames).toBe(2);
    expect(p.snapshot().framesOfAudio).toBe(FRAMES * 2);
  });

  it("counts and discards binary that is not ours, rather than playing it", () => {
    const sink = new FakeSink();
    const p = new StreamPlayer(sink, new FakeClock().now);
    expect(p.handle(new TextEncoder().encode("not audio").buffer)).toBeNull();
    expect(sink.pushes).toHaveLength(0);
    expect(p.snapshot().rejected).toBe(1);
    expect(p.snapshot().frames).toBe(0);
  });

  it("reports the format the first frame declared", () => {
    const p = new StreamPlayer(new FakeSink(), new FakeClock().now);
    p.handle(bytes({ channels: 1, sampleRate: 44100 }));
    expect(p.snapshot().format).toEqual({ channels: 1, sampleRate: 44100 });
  });
});

// TCP loses nothing, so a sequence jump is always a decision, and the samples on either side are unrelated.
describe("a gap the sender caused", () => {
  it("is counted and re-cushioned", () => {
    const sink = new FakeSink();
    const p = new StreamPlayer(sink, new FakeClock().now);
    p.handle(bytes({ seq: 0 }));
    const resetsBefore = sink.resets;
    p.handle(bytes({ seq: 4 })); // 1, 2, 3 never arrived
    expect(p.snapshot().dropped).toBe(3);
    expect(sink.resets).toBe(resetsBefore + 1);
  });

  it("does not re-cushion when nothing was dropped", () => {
    const sink = new FakeSink();
    const p = new StreamPlayer(sink, new FakeClock().now);
    p.handle(bytes({ seq: 0 }));
    const after = sink.resets;
    p.handle(bytes({ seq: 1 }));
    p.handle(bytes({ seq: 2 }));
    expect(p.snapshot().dropped).toBe(0);
    expect(sink.resets).toBe(after);
  });

  it("counts nothing dropped across the sequence wrap", () => {
    const p = new StreamPlayer(new FakeSink(), new FakeClock().now);
    p.handle(bytes({ seq: 0xffffffff }));
    p.handle(bytes({ seq: 0 }));
    expect(p.snapshot().dropped).toBe(0);
  });
});

// A rate or channel change is a pitch shift or a scrambled interleave, so it has to surface rather than be smoothed over.
describe("a format change", () => {
  it("is counted and flushes what was buffered", () => {
    const sink = new FakeSink();
    const p = new StreamPlayer(sink, new FakeClock().now);
    p.handle(bytes({ sampleRate: 48000 }));
    const after = sink.resets;
    p.handle(bytes({ sampleRate: 44100 }));
    expect(p.snapshot().formatChanges).toBe(1);
    expect(p.snapshot().format?.sampleRate).toBe(44100);
    expect(sink.resets).toBe(after + 1);
  });

  it("is not counted for the very first frame, which changes nothing", () => {
    const p = new StreamPlayer(new FakeSink(), new FakeClock().now);
    p.handle(bytes());
    expect(p.snapshot().formatChanges).toBe(0);
  });

  it("notices a channel count change too", () => {
    const p = new StreamPlayer(new FakeSink(), new FakeClock().now);
    p.handle(bytes({ channels: 2 }));
    p.handle(bytes({ channels: 1, frames: FRAMES }));
    expect(p.snapshot().formatChanges).toBe(1);
  });
});

// The measurements are the POINT of this step, and what matters is that they mean what they claim: the spread, not the mean.
describe("what the measurements say", () => {
  it("reports a spread of zero for perfectly paced arrivals", () => {
    const clock = new FakeClock();
    const p = new StreamPlayer(new FakeSink(), clock.now);
    for (let i = 0; i < 10; i++) {
      clock.at(1000 + i * 10); // arrivals 10 ms apart…
      p.handle(bytes({ seq: i, captureMs: 5000 + i * 10 })); // …like the captures
    }
    const j = p.snapshot().jitterMs;
    expect(j.max - j.min).toBe(0);
  });

  it("cancels the offset between two unrelated machine clocks", () => {
    // The two clocks start at unrelated moments, so a player reporting the raw difference would call that constant offset "latency".
    const clock = new FakeClock();
    const p = new StreamPlayer(new FakeSink(), clock.now);
    clock.at(50);
    p.handle(bytes({ seq: 0, captureMs: 900_000 }));
    clock.at(60);
    p.handle(bytes({ seq: 1, captureMs: 900_010 }));
    expect(p.snapshot().jitterMs.last).toBe(0);
  });

  it("measures a late frame as the amount it was late by", () => {
    const clock = new FakeClock();
    const p = new StreamPlayer(new FakeSink(), clock.now);
    clock.at(0);
    p.handle(bytes({ seq: 0, captureMs: 0 }));
    clock.at(37); // captured for t=10, arrived at 37 → 27 ms late
    p.handle(bytes({ seq: 1, captureMs: 10 }));
    expect(p.snapshot().jitterMs.last).toBe(27);
    expect(p.snapshot().jitterMs.max).toBe(27);
  });

  it("withholds a drift figure until there is enough time to mean one", () => {
    const clock = new FakeClock();
    const p = new StreamPlayer(new FakeSink(), clock.now);
    clock.at(0);
    p.handle(bytes({ seq: 0, captureMs: 0 }));
    clock.at(500);
    p.handle(bytes({ seq: 1, captureMs: 490 }));
    // Ten ms over half a second is jitter, and extrapolated it would read as 1.2 s/min — null is the honest answer.
    expect(p.snapshot().driftMsPerMin).toBeNull();
  });

  it("reports drift once a minute of stream has gone by", () => {
    const clock = new FakeClock();
    const p = new StreamPlayer(new FakeSink(), clock.now);
    clock.at(0);
    p.handle(bytes({ seq: 0, captureMs: 0 }));
    // Two minutes of capture arriving over two minutes plus 6 ms: 3 ms per minute.
    clock.at(120_006);
    p.handle(bytes({ seq: 1, captureMs: 120_000 }));
    expect(p.snapshot().driftMsPerMin).toBeCloseTo(3, 6);
  });

  it("restarts its clocks after a gap, so one stall is not read as drift forever", () => {
    const clock = new FakeClock();
    const p = new StreamPlayer(new FakeSink(), clock.now);
    clock.at(0);
    p.handle(bytes({ seq: 0, captureMs: 0 }));
    clock.at(5000); // a 5 s stall, during which the sender dropped
    p.handle(bytes({ seq: 100, captureMs: 1000 }));
    expect(p.snapshot().jitterMs.last).toBe(0);
    expect(p.snapshot().driftMsPerMin).toBeNull();
  });
});

describe("resetting", () => {
  it("clears the counters and the sink together", () => {
    const sink = new FakeSink();
    const p = new StreamPlayer(sink, new FakeClock().now);
    p.handle(bytes({ seq: 0 }));
    p.handle(bytes({ seq: 9 }));
    p.reset();
    expect(p.snapshot().frames).toBe(0);
    expect(p.snapshot().dropped).toBe(0);
    expect(p.snapshot().format).toBeNull();
    // …and a frame after a reset must not be read against the pre-reset sequence.
    p.handle(bytes({ seq: 500 }));
    expect(p.snapshot().dropped).toBe(0);
  });
});
