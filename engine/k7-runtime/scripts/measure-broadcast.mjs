// measure-broadcast.mjs — the broadcast measurement, headless. Starts nothing: point it at a
// running engine, subscribe, and read off the four numbers that decide the real design —
// jitter spread, drift, sender-caused gaps, and whether audio actually flows.
//
// Usage: node engine/k7-runtime/scripts/measure-broadcast.mjs [ws://127.0.0.1:8765] [seconds]

import { decodeStreamFrame, seqGap } from "@studio/engine-protocol/stream";
import WebSocket from "ws";

const url = process.argv[2] ?? "ws://127.0.0.1:8765";
const seconds = Number(process.argv[3] ?? 20);

const st = {
  frames: 0,
  audioFrames: 0,
  dropped: 0,
  rejected: 0,
  bytes: 0,
  rate: 0,
  channels: 0,
  nonZero: 0, // frames carrying any sample != 0 — silence and no-signal look identical otherwise
  peak: 0,
  lastSeq: null,
  originCapture: 0,
  originArrival: 0,
  jitMin: Infinity,
  jitMax: -Infinity,
  lastDelta: 0,
  firstAt: 0,
  gaps: [],
};

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";

ws.on("open", () => {
  console.log(`connected to ${url}, listening for ${seconds}s`);
  // A project FIRST, and one that makes a SOUND: silence and a missing tap look identical.
  ws.send(
    JSON.stringify({
      type: "project",
      doc: {
        name: "broadcast-measure",
        tempo: 120,
        sampleRate: 48000,
        timeSigNumerator: 4,
        timeSigDenominator: 4,
        recordDir: "",
        settings: { metronome: false, countIn: 0 },
        tracks: [
          {
            id: "t1",
            name: "tone",
            clips: [
              {
                id: "c1",
                type: "midi",
                name: "tone",
                start: 0,
                length: 600,
                notes: [
                  { time: 0, duration: 600, key: 57, vel: 0.9, channel: 1 },
                ],
              },
            ],
            plugins: [
              { id: "t1:synth", type: "4osc", name: "synth", role: "instrument" },
            ],
          },
        ],
        groups: [],
      },
    }),
  );
  ws.send(JSON.stringify({ type: "transport", action: "play" }));
  ws.send(JSON.stringify({ type: "broadcast", on: true }));
});

ws.on("message", (data, isBinary) => {
  if (!isBinary) return; // the JSON state frames are not what this measures
  // A Buffer is a WINDOW into a shared pool, hence the explicit slice before reading offsets.
  const buf =
    data instanceof ArrayBuffer
      ? data
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const f = decodeStreamFrame(buf);
  if (!f) {
    st.rejected++;
    return;
  }
  const now = performance.now();
  st.bytes += buf.byteLength;
  st.rate = f.sampleRate;
  st.channels = f.channels;
  st.audioFrames += f.frames;

  let peak = 0;
  for (let i = 0; i < f.samples.length; i++) {
    const a = Math.abs(f.samples[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) st.nonZero++;
  if (peak > st.peak) st.peak = peak;

  if (st.lastSeq === null) {
    st.originCapture = f.captureMs;
    st.originArrival = now;
    st.firstAt = now;
  } else {
    const gap = seqGap(st.lastSeq, f.seq);
    if (gap > 0) {
      st.dropped += gap;
      st.gaps.push({ atMs: Math.round(now - st.firstAt), frames: gap });
      // Re-origin, as StreamPlayer does: a gap's stall would otherwise read as drift for ever.
      st.originCapture = f.captureMs;
      st.originArrival = now;
      st.jitMin = Infinity;
      st.jitMax = -Infinity;
    } else {
      const delta =
        now - st.originArrival - (f.captureMs - st.originCapture);
      st.lastDelta = delta;
      if (delta < st.jitMin) st.jitMin = delta;
      if (delta > st.jitMax) st.jitMax = delta;
    }
  }
  st.lastSeq = f.seq;
  st.frames++;
});

ws.on("error", (e) => {
  console.error(`socket error: ${e.message}`);
  process.exit(1);
});

setTimeout(() => {
  const elapsed = (performance.now() - st.firstAt) / 1000;
  const audioSecs = st.rate ? st.audioFrames / st.rate : 0;
  console.log("");
  if (st.frames === 0) {
    console.log("NO FRAMES AT ALL.");
    console.log(
      st.rejected > 0
        ? `  ${st.rejected} binary messages arrived but none decoded — the wire formats disagree.`
        : "  Nothing binary arrived: the tap never produced, or the subscription was refused.",
    );
    process.exit(2);
  }
  const line = (k, v) => console.log(`  ${k.padEnd(26)} ${v}`);
  console.log("=== broadcast, measured ===");
  line("frames received", st.frames);
  line("format", `${st.rate} Hz, ${st.channels} ch`);
  line("audio delivered", `${audioSecs.toFixed(2)}s over ${elapsed.toFixed(2)}s wall`);
  line("realtime ratio", (audioSecs / elapsed).toFixed(4));
  line("bitrate", `${((st.bytes * 8) / elapsed / 1e6).toFixed(2)} Mbit/s`);
  line("frames with signal", `${st.nonZero}/${st.frames} (peak ${st.peak.toFixed(4)})`);
  line("dropped by sender", st.dropped);
  line("undecodable", st.rejected);
  if (st.jitMax > -Infinity)
    line(
      "jitter spread",
      `${(st.jitMax - st.jitMin).toFixed(2)} ms  (min ${st.jitMin.toFixed(2)}, max ${st.jitMax.toFixed(2)})`,
    );
  // Drift needs a minute to mean anything; below that the slope is jitter.
  const capElapsed = audioSecs * 1000;
  line(
    "drift",
    capElapsed >= 60_000
      ? `${((st.lastDelta / capElapsed) * 60_000).toFixed(2)} ms/min`
      : `not enough stream yet (need 60s of audio, had ${audioSecs.toFixed(0)}s)`,
  );
  if (st.gaps.length)
    line("gap timeline", JSON.stringify(st.gaps.slice(0, 10)));
  // The realtime ratio is the honest health check: 1.0 means the sender kept up exactly.
  if (audioSecs / elapsed < 0.98)
    console.log(
      "\n  WARNING: less audio arrived than time passed — the sender is not keeping up.",
    );
  ws.close();
  process.exit(0);
}, seconds * 1000);
