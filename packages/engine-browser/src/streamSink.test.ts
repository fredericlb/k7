import { describe, expect, it } from "vitest";
import { PROCESSOR_SOURCE } from "./streamSink";

type Stats = {
  depth: number;
  underruns: number;
  overruns: number;
  skips: number;
};
interface Processor {
  port: { onmessage: (e: { data: unknown }) => void; posted: Stats[] };
  process(inputs: unknown, outputs: Float32Array[][]): boolean;
}

// The processor source run as the worklet would, against a fake base class and a registry that keeps the class.
function makeProcessor(options: Record<string, number>): Processor {
  let Cls: new (o: unknown) => Processor = null as never;
  class FakeBase {
    port = {
      onmessage: (_e: { data: unknown }) => {},
      posted: [] as Stats[],
      postMessage(m: Stats) {
        this.posted.push(m);
      },
    };
  }
  new Function("AudioWorkletProcessor", "registerProcessor", PROCESSOR_SOURCE)(
    FakeBase,
    (_name: string, c: typeof Cls) => {
      Cls = c;
    },
  );
  return new Cls({ processorOptions: { channels: 1, ...options } });
}

const BLOCK = 128;
// Mono frames whose value is their own index in the stream, so a read position shows in the output.
let next = 0;
function push(p: Processor, frames: number) {
  const s = new Float32Array(frames);
  for (let i = 0; i < frames; i++) s[i] = next++;
  p.port.onmessage({ data: s });
}
function play(p: Processor): Float32Array {
  const out = [new Float32Array(BLOCK)];
  p.process([], [out]);
  return out[0];
}
const last = (p: Processor) => p.port.posted[p.port.posted.length - 1];

// A live stream: one 480-frame frame in for every 480 frames played, so the depth neither grows nor drains.
function steady(p: Processor, frames: number, out: Float32Array[] = []) {
  for (let played = 0; played < frames; played += BLOCK) {
    if (played % 480 < BLOCK) push(p, 480);
    out.push(play(p));
  }
  return out;
}

describe("the stream sink's latency cap", () => {
  const opts = { startFrames: 1000, maxFrames: 3000, holdFrames: 4000 };

  it("is off unless asked for: a backlog stays as latency", () => {
    next = 0;
    const p = makeProcessor({ startFrames: 1000 });
    push(p, 8000);
    steady(p, 20000);
    expect(last(p).skips).toBe(0);
    expect(play(p)[0]).toBeLessThan(next - 7000);
  });

  it("cuts a held backlog back to the cushion, once", () => {
    next = 0;
    const p = makeProcessor(opts);
    push(p, 8000);
    steady(p, 20000);
    expect(last(p).skips).toBe(1);
    // What is played now is about startFrames behind what arrived.
    const behind = next - play(p)[0];
    expect(behind).toBeGreaterThan(900);
    expect(behind).toBeLessThan(1000 + 480 + BLOCK);
  });

  it("leaves a brief jitter peak alone", () => {
    next = 0;
    const p = makeProcessor(opts);
    push(p, 1000);
    steady(p, 2000);
    // A burst: 3000 frames at once, then nothing until they are played out.
    push(p, 3000);
    for (let played = 0; played < 3000; played += BLOCK) play(p);
    steady(p, 20000);
    expect(last(p).skips).toBe(0);
  });

  it("crossfades the jump and plays on from the new position", () => {
    next = 0;
    const p = makeProcessor(opts);
    push(p, 8000);
    const out = steady(p, 20000);
    const at = out.findIndex(
      (b, i) => i > 0 && b[0] !== out[i - 1][BLOCK - 1] + 1,
    );
    expect(at).toBeGreaterThan(0);
    const fade = out[at];
    // Starts at the old position, ends near the new one, and the block after continues from it.
    const from = out[at - 1][BLOCK - 1] + 1;
    const jump = out[at + 1][0] - BLOCK - from;
    expect(jump).toBeGreaterThan(0);
    expect(fade[0] - from).toBeLessThan(jump / BLOCK + 1);
    expect(out[at + 1][0] - fade[BLOCK - 1]).toBeLessThan(jump / BLOCK + 2);
    for (let i = 1; i < BLOCK; i++)
      expect(fade[i]).toBeGreaterThan(fade[i - 1]);
    expect(out[at + 1][1]).toBe(out[at + 1][0] + 1);
  });

  it("starts the hold over after an underrun", () => {
    next = 0;
    const p = makeProcessor(opts);
    push(p, 4000);
    for (let played = 0; played < 3000; played += BLOCK) play(p);
    // Starved, then refilled above the cap: the earlier time above it must not count.
    for (let i = 0; i < 20; i++) play(p);
    push(p, 3500);
    steady(p, 3000);
    expect(last(p).skips).toBe(0);
  });
});
