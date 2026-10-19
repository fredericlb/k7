// measure.ts — what one sidecar's measure costs: envelope.ts against the Rust build, on five minutes of 48 kHz stereo.
// A reader would get wrong what is timed: the mono sum, the pass over every sample and the tempo, not the decode (docs/analysis.md).

import { monoFromInterleaved } from "../src/decode.ts";
import { buildEnvelope, envelopeFrom, followers } from "../src/envelope.ts";
import { measureKind, openMeasure } from "../src/native.ts";

const RATE = 48000;
const FRAMES = RATE * 300;
const CHUNK = 48000;
const parts: Float32Array[] = [];
for (let at = 0; at < FRAMES; at += CHUNK) {
  const block = new Float32Array(CHUNK * 2);
  for (let f = 0; f < CHUNK; f++) {
    const t = at + f;
    const v = t % 24000 < 300 ? 0.8 * Math.sin(t) : 0.05 * Math.sin(t / 37);
    block[2 * f] = v;
    block[2 * f + 1] = -v;
  }
  parts.push(block);
}
const facts = { sampleRate: RATE, channels: 2, frames: FRAMES };

function js(): number {
  const mono = parts.map((p) => monoFromInterleaved(p, 2, p.length / 2));
  return buildEnvelope({ ...facts, mono }, "fp").bpm;
}

function rust(): number {
  const m = openMeasure();
  if (!m) throw new Error("no Rust build in this runtime");
  for (const p of parts) m.push(p, 2);
  const { aLow, aHigh } = followers(RATE);
  const env = envelopeFrom(
    m.measure(aLow, aHigh),
    facts,
    "fp",
    2,
    m.correlations,
  );
  m.close();
  return env.bpm;
}

function time(label: string, f: () => number, runs: number): void {
  const ms: number[] = [];
  let bpm = 0;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    bpm = f();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(
    `  ${label}: median ${ms[ms.length >> 1].toFixed(0)} ms, worst ${ms[ms.length - 1].toFixed(0)} ms (bpm ${bpm})`,
  );
}

const jitless = process.execArgv.includes("--jitless");
console.log(
  `five minutes of 48 kHz stereo; jitless ${jitless}; K7X_ADDON ${process.env.K7X_ADDON ? "set" : "unset"}`,
);
const runs = jitless ? 3 : 7;
time("envelope.ts (JS)", js, runs);
let rustOk = true;
try {
  rust();
} catch {
  rustOk = false;
}
if (rustOk) time(`Rust (${measureKind()})`, rust, runs);
else console.log("  Rust: none in this runtime");
