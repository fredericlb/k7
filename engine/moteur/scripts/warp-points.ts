// warp-points.ts — proves a clip's INTERIOR warp points move the sound, by rendering and
// measuring. Two cases: a map whose ends are identity (only the middle can move anything), and
// one that also compresses overall, which is what a real recording's map does.
//   npx tsx engine/moteur/scripts/warp-points.ts

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderProject } from "../../../packages/file-service/src/render.ts";

const RATE = 48000;
const TEMPO = 120; // 2 beats per second, so a beat is exactly 0.5s and the arithmetic reads plainly
const SRC_SECS = 8;
// Where a burst STARTS in the source, off every marker and off sample 0 (../docs/renderHarnesses.md).
const BURSTS = [1, 3, 5, 7];
const BURST_LEN = 0.12;

type Marker = [beat: number, sec: number];

interface Case {
  name: string;
  markers: Marker[];
}

const CASES: Case[] = [
  {
    // Ends identity, so auto-tempo stretches by exactly 1.0 (../docs/renderHarnesses.md).
    name: "ends identiques, seuls les points du milieu bougent",
    markers: [
      [0, 0],
      [6, 2], // source 2s, linearly beat 4, pulled late to beat 6
      [10, 4], // source 4s, linearly beat 8, pulled late to beat 10
      [16, 8],
    ],
  },
  {
    // A real recording's shape: squeezed overall AND re-timed inside (../docs/renderHarnesses.md).
    name: "compression d'ensemble + points intermediaires",
    markers: [
      [0, 0],
      [6, 2],
      [10, 4],
      [12, 8],
    ],
  },
];

/** Where a source second lands: the piecewise interpolation `beatAtSource` does, in seconds. */
function expectedSecs(markers: Marker[], sourceSec: number): number {
  let i = 0;
  while (i + 2 < markers.length && markers[i + 1][1] < sourceSec) i++;
  const [b0, s0] = markers[i];
  const [b1, s1] = markers[i + 1];
  const beat = b0 + ((sourceSec - s0) / (s1 - s0)) * (b1 - b0);
  return (beat * 60) / TEMPO;
}

/** A 16-bit stereo wav of 1 kHz bursts on silence: an envelope survives stretching, a click does not. */
function writeSource(path: string): void {
  const frames = Math.round(SRC_SECS * RATE);
  const data = Buffer.alloc(frames * 4);
  for (let n = 0; n < frames; n++) {
    const t = n / RATE;
    const on = BURSTS.some((b) => t >= b && t < b + BURST_LEN);
    const v = on ? Math.round(Math.sin(2 * Math.PI * 1000 * t) * 12000) : 0;
    data.writeInt16LE(v, n * 4);
    data.writeInt16LE(v, n * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([head, data]));
}

interface Wav {
  rate: number;
  mono: Float32Array;
}

/** Enough of a wav reader for what the engine writes: PCM 16/24/32 or float32, any chunk order. */
function readWav(path: string): Wav {
  const b = readFileSync(path);
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let format = 1;
  let mono = new Float32Array(0);
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString("ascii", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === "fmt ") {
      format = b.readUInt16LE(i + 8);
      channels = b.readUInt16LE(i + 10);
      rate = b.readUInt32LE(i + 12);
      bits = b.readUInt16LE(i + 22);
    } else if (id === "data") {
      const bytes = bits / 8;
      const frames = Math.floor(size / (bytes * channels));
      mono = new Float32Array(frames);
      for (let n = 0; n < frames; n++) {
        const o = i + 8 + n * bytes * channels;
        let s = 0;
        if (format === 3) s = b.readFloatLE(o);
        else if (bits === 16) s = b.readInt16LE(o) / 32768;
        else if (bits === 24)
          s = ((b[o] | (b[o + 1] << 8) | ((b[o + 2] << 24) >> 8)) << 8) / 2147483648;
        else if (bits === 32) s = b.readInt32LE(o) / 2147483648;
        mono[n] = s;
      }
      break;
    }
    i += 8 + size + (size % 2);
  }
  return { rate, mono };
}

/** Each burst's energy CENTROID in seconds, never its onset (../docs/renderHarnesses.md). */
function centroids(w: Wav): number[] {
  const hop = Math.round(w.rate * 0.005);
  const env: number[] = [];
  for (let n = 0; n + hop <= w.mono.length; n += hop) {
    let sum = 0;
    for (let k = 0; k < hop; k++) sum += w.mono[n + k] * w.mono[n + k];
    env.push(sum / hop); // energy, not RMS: the centroid should weight by power
  }
  const gate = Math.max(...env) * 0.05;
  const out: number[] = [];
  let num = 0;
  let den = 0;
  let quiet = 0;
  for (let f = 0; f <= env.length; f++) {
    const on = f < env.length && env[f] > gate;
    if (on) {
      num += ((f * hop) / w.rate) * env[f];
      den += env[f];
      quiet = 0;
    } else if (den > 0 && ++quiet >= 8) {
      out.push(num / den); // 40ms of silence ends a burst; a burst is 120ms
      num = 0;
      den = 0;
    }
  }
  if (den > 0) out.push(num / den);
  return out;
}

function docFor(src: string, markers: Marker[]): unknown {
  return {
    name: "warp-points",
    tempo: TEMPO,
    sampleRate: RATE,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    recordDir: "",
    settings: { metronome: false, countIn: 0 },
    groups: [],
    tracks: [
      {
        id: "t1",
        name: "src",
        clips: [
          {
            id: "c1",
            type: "audio",
            name: "bursts",
            source: src,
            start: 0,
            length: markers[markers.length - 1][0],
            offset: 0,
            fadeIn: 0,
            fadeOut: 0,
            loopStart: 0,
            loopEnd: 0,
            notes: [],
            warp: { algorithm: "elastique", markers },
          },
        ],
        plugins: [],
      },
    ],
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "warp-points-"));
  const src = join(dir, "bursts.wav");
  writeSource(src);
  const fmt = (v: number[]) => v.map((x) => x.toFixed(3).padStart(7)).join(" ");
  let allOk = true;

  for (const c of CASES) {
    const last = c.markers[c.markers.length - 1];
    // Where each burst's MIDDLE lands: the centroid is measured, so it is what is predicted.
    const want = BURSTS.map((b) => expectedSecs(c.markers, b + BURST_LEN / 2));

    // The same, had the interior points been dropped — one straight ratio, end to end.
    const linear = BURSTS.map(
      (b) => (((b + BURST_LEN / 2) / last[1]) * last[0] * 60) / TEMPO,
    );

    const out = await renderProject(docFor(src, c.markers));
    const heard = centroids(readWav(out.files[0]));
    rmSync(out.dir, { recursive: true, force: true });

    // Loose on purpose, so the discrimination check below carries it (../docs/renderHarnesses.md).
    const TOL = 0.1;
    const near =
      heard.length === want.length &&
      want.every((v, k) => Math.abs(heard[k] - v) <= TOL);
    const closer = want.every(
      (v, k) => Math.abs(heard[k] - v) * 3 < Math.abs(heard[k] - linear[k]),
    );
    const ok = near && closer;
    allOk &&= ok;

    console.log(`\n${c.name}`);
    console.log(`  attendu (carte) : ${fmt(want)}`);
    console.log(`  sans les points : ${fmt(linear)}`);
    console.log(`  entendu         : ${fmt(heard)}`);
    console.log(`  ecart / carte   : ${fmt(want.map((v, k) => heard[k] - v))}`);
    console.log(`  ${ok ? "OK" : `ECHEC (proche=${near} discrimine=${closer})`}`);
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(
    allOk
      ? "\nOK — les points intermediaires deplacent le son"
      : "\nECHEC — le rendu ne suit pas la carte",
  );
  process.exit(allOk ? 0 : 1);
}

void main();
