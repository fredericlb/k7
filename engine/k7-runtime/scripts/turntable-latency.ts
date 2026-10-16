// turntable-latency.ts — how long after a HAND moves does the audio? Point it at a running engine.
//
//   npx tsx engine/k7-runtime/scripts/turntable-latency.ts [ws://127.0.0.1:8765] [--n=12]
//
// It steps the rate at a known moment and finds where the tone changed. It includes the socket, the
// queue, the block boundary and the 6 ms glide, and excludes the device's own output buffer; the
// stream's origin is the LEAST delayed frame. Why, and the numbers: docs/turntable.md.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { onBroadcast } from "./platterBench";
import { wavFile } from "./wav.ts";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const RUNS = Number(/--n=(\d+)/.exec(process.argv.join(" "))?.[1] ?? "12");
const SESSION = "m9:latency";
const PLUGIN = "deckA:platter";

const RATE = 48000;
const SECONDS = 120;
const TONE = 1000;
/** The step: one octave up, which is unmistakable and lands well inside the analysis band. */
const FROM = 1;
const TO = 2;
/** Where the tone is judged to have changed — halfway, so neither end's settling decides it. */
const CROSS = (TONE * (FROM + TO)) / 2;
const GAP_MS = 900;

function tone(): string {
  const n = RATE * SECONDS;
  const pcm = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * TONE) / RATE;
    pcm.writeInt16LE(Math.round(Math.sin(phase) * 0.25 * 32767), i * 2);
  }
  const file = join(
    mkdtempSync(join(process.env.STUDIO_SCRATCH ?? tmpdir(), "m9-lat-")),
    "tone.wav",
  );
  writeFileSync(file, wavFile(pcm, RATE, 1, 16));
  return file;
}

/** Zero crossings give the frequency of a pure tone far more cheaply than an FFT, and per BLOCK. */
function hzOf(x: Float32Array, from: number, n: number): number {
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = from + 1; i < from + n; i++)
    if (x[i - 1] <= 0 && x[i] > 0) {
      if (first < 0) first = i;
      last = i;
      crossings++;
    }
  return crossings >= 2 ? ((crossings - 1) * RATE) / (last - first) : 0;
}

const source = tone();

const doc = () => ({
  name: "latency",
  tempo: 120,
  sampleRate: RATE,
  timeSigNumerator: 4,
  timeSigDenominator: 4,
  masterVolume: 0,
  masterPlugins: [],
  recordDir: "",
  settings: { metronome: false, countIn: 0 },
  groups: [],
  markers: [],
  tracks: [
    {
      id: "deckA",
      name: "deckA",
      role: "regular",
      contentType: "audio",
      group: "",
      generated: false,
      color: "",
      mute: false,
      solo: false,
      disabled: false,
      inputChannels: [],
      outputChannels: [],
      monitor: "auto",
      inputGain: 0,
      clips: [],
      plugins: [
        {
          id: PLUGIN,
          type: "studio_turntable",
          name: "platter",
          path: "",
          deckFile: source,
          presetSave: "",
          role: "instrument",
          enabled: true,
          params: { Rate: FROM, Seek: 0, Gain: 1 },
        },
      ],
      sends: [],
      automation: [],
    },
  ],
});

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));

const chunks: Float32Array[] = [];
let total = 0;
/** The least-delayed estimate of when sample 0 was produced — see the header. */
let originOf = () => Number.POSITIVE_INFINITY;
/** Each step: when it was SENT, and the sample the stream was at when it went. */
const steps: { sent: number; from: number; up: boolean }[] = [];

ws.on("open", () => {
  send({ type: "project", doc: doc() });
  send({ type: "transport", action: "play" });
  send({ type: "broadcast", on: true });
});

// The shared reader: it keeps the least-delayed origin and resamples a stream at the device's rate to RATE.
originOf = onBroadcast(ws, RATE, (mono) => {
  chunks.push(mono);
  total += mono.length;
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

let done = 0;
let up = true;
function step() {
  if (done >= RUNS) return setTimeout(finish, 800);
  done++;
  up = !up;
  steps.push({ sent: performance.now(), from: total, up });
  send({
    type: "set-plugin-param",
    id: PLUGIN,
    name: "Rate",
    value: up ? TO : FROM,
  });
  setTimeout(step, GAP_MS);
}
setTimeout(step, 4000);

function finish() {
  send({ type: "transport", action: "stop" });
  send({ type: "broadcast", on: false });
  send({ type: "drop-session" });

  const buf = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.length;
  }

  const WIN = 256; // 5.3 ms — finer than the answer, so the answer is not the window
  const found: number[] = [];
  for (const s of steps) {
    // Search forward from the SEND: the change cannot have happened before it was asked for.
    let hit = -1;
    for (let i = Math.max(0, s.from - WIN); i + WIN <= buf.length; i += WIN) {
      const hz = hzOf(buf, i, WIN);
      if (hz <= 0) continue;
      if (s.up ? hz > CROSS : hz < CROSS) {
        hit = i;
        break;
      }
    }
    if (hit < 0) continue;
    const heardAt = originOf() + (hit / RATE) * 1000;
    const ms = heardAt - s.sent;
    // A negative reading means the origin estimate is off, not that the future arrived — dropped, and counted.
    if (ms >= 0) found.push(ms);
  }

  found.sort((a, b) => a - b);
  if (!found.length) {
    console.log("ECHEC — aucun changement de ton localisé");
    process.exit(1);
  }
  const at50 = found[Math.floor(found.length / 2)];
  const spread = found[found.length - 1] - found[0];
  // The block the engine renders in: what a message waits for, and the shape the readings should take.
  const block = (256 / RATE) * 1000;

  console.log(`pas mesurés          : ${found.length}/${steps.length}`);
  console.log(`le plus rapide       : ${found[0].toFixed(1)} ms`);
  console.log(`médiane              : ${at50.toFixed(1)} ms`);
  console.log(`le plus lent         : ${found[found.length - 1].toFixed(1)} ms`);
  console.log(`étendue              : ${spread.toFixed(1)} ms`);
  console.log(`un bloc de 256 vaut  : ${block.toFixed(1)} ms`);
  console.log(
    `\nLa lecture qui compte est la FORME : une étendue d'un bloc et une médiane à sa moitié\n` +
      `veulent dire que le message attend la frontière de bloc et RIEN d'autre — pas la file, pas\n` +
      `le socket, pas le glissement. Ici ${spread.toFixed(1)} ms d'étendue pour ${block.toFixed(1)} ms de bloc,\n` +
      `médiane ${at50.toFixed(1)} ms pour ${(block / 2).toFixed(1)} attendue.`,
  );
  // Said rather than hidden: the origin leans early, so readings below zero are dropped and counted here.
  console.log(
    `\n${steps.length - found.length} pas écartés : l'origine du flux est estimée sur la trame la MOINS\n` +
      `retardée, donc elle penche tôt et pousse quelques lectures sous zéro. Le chiffre est un\n` +
      `plancher, pas une moyenne.`,
  );
  console.log(
    "\nIl COMPREND le socket, la file du moteur, la frontière de bloc et le glissement de 6 ms.",
  );
  console.log(
    "Il EXCLUT le tampon de sortie du device — le tap est avant lui (docs/turntable.md).",
  );
  process.exit(0);
}
