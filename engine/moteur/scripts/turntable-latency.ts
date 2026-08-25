// turntable-latency.ts — how long after a HAND moves does the audio? Point it at a running engine.
//
//   npx tsx engine/moteur/scripts/turntable-latency.ts [ws://127.0.0.1:8765] [--n=12]
//
// The platter follows a hand accurately (docs/turntable.md); this asks the other question, which is
// whether it follows SOON. It steps the rate at a known moment and finds where the tone changed.
//
// The tap carries its own buffering, so the stream's origin is estimated by keeping the LEAST
// DELAYED frame of the run — the technique `@studio/engine-browser/playhead-clock` uses for the same
// reason, and for the same reason it converges on the minimum rather than the mean.
//
// WHAT IT INCLUDES: the socket, the engine's message queue, the block boundary, and the plugin's
// 6 ms glide. WHAT IT EXCLUDES: the audio device's own output buffer, which the tap sits before —
// add `2 x buffer / rate` from `whoami` for what a speaker does. See docs/turntable.md.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

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
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  const file = join(
    mkdtempSync(join(process.env.STUDIO_SCRATCH ?? tmpdir(), "m9-lat-")),
    "tone.wav",
  );
  writeFileSync(file, Buffer.concat([h, pcm]));
  return file;
}

/** The same file, named the way the ENGINE will have to open it. Identity everywhere but WSL. */
function asEngineSees(path: string): string {
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(path);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}` : path;
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
  strudel: false,
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
          deckFile: asEngineSees(source),
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
let origin = Number.POSITIVE_INFINITY;
/** Each step: when it was SENT, and the sample the stream was at when it went. */
const steps: { sent: number; from: number; up: boolean }[] = [];

ws.on("open", () => {
  send({ type: "project", doc: doc() });
  send({ type: "transport", action: "play" });
  send({ type: "broadcast", on: true });
});

ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
  if (!isBinary) return;
  const buf =
    data instanceof ArrayBuffer
      ? data
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x4c535452) return;
  const channels = dv.getUint8(5);
  const frames = dv.getUint32(12, true);
  const all = new Float32Array(buf, 32, frames * channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = all[i * channels];
  // This chunk ENDS at `total + frames`, so it was produced no later than now — keep the tightest.
  const guess = performance.now() - ((total + frames) / RATE) * 1000;
  if (guess < origin) origin = guess;
  chunks.push(mono);
  total += frames;
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
    const heardAt = origin + (hit / RATE) * 1000;
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
  // Said rather than hidden: the origin is the LEAST delayed guess, so it leans early and some
  // readings fall below zero. Those are dropped, which is why the count is not the number of steps.
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
