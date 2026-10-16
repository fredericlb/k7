// recorder-probe.ts — a recorder node's take comes out WHOLE while the message thread is busy:
// it records a held note, sends large documents one after another, each forcing a full rebuild,
// stops, and checks the take is not damaged and its wav holds what the clock said (docs/recorder.md).
// A rebuild swaps the graph, so the take is SHORTER than the wall clock: no audio flows meanwhile.
//
//   npx tsx engine/k7-runtime/scripts/recorder-probe.ts [ws://127.0.0.1:8765] [--dir <recordDir>]
//
// `--dir` must be a folder the engine may WRITE (its state dir, or STUDIO_ENGINE_ROOTS).

import { existsSync, readFileSync } from "node:fs";
import WebSocket from "ws";

const url = process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const dirAt = process.argv.indexOf("--dir");
const recordDir = dirAt > 0 ? process.argv[dirAt + 1] : "";
if (!recordDir) {
  console.error("--dir <recordDir> is required");
  process.exit(2);
}
const SESSION = "m9:recorder-probe";
const NODE = "lane:rec";
const BEATS = 1024;
const BURST = 6;
const EXTRA_TRACKS = 48;

const plugin = (id: string, type: string, role: string, extra: Record<string, unknown> = {}) => ({
  id, type, name: type, path: "", presetSave: "", role, enabled: true, params: {}, ...extra,
});

const track = (id: string, plugins: unknown[]) => ({
  id, name: id, role: "regular", contentType: "midi", group: "", generated: false, color: "",
  mute: false, solo: false, disabled: false, inputChannels: [], outputChannels: [],
  monitor: "auto", inputGain: 0,
  clips: [{
    id: `${id}:held`, type: "midi", name: "held", source: "", start: 0, length: BEATS, offset: 0,
    fadeIn: 0, fadeOut: 0, loopStart: 0, loopEnd: 0,
    notes: [{ time: 0, duration: BEATS, key: 57, vel: 0.9, channel: 1, rel: 0 }],
  }],
  plugins, sends: [], automation: [],
});

// A Faust program that differs per document, so every apply compiles it again rather than reusing one.
const faust = (n: number) =>
  `process = _ : *(${(0.5 + n / 1000).toFixed(4)}) : +~*(0.${(n % 9) + 1});`;

/** The recorder's lane, always the same, then `n` heavy lanes that change with every document. */
const doc = (n: number) => ({
  name: `recorder-probe-${n}`, tempo: 120, sampleRate: 48000, timeSigNumerator: 4,
  timeSigDenominator: 4, masterVolume: 0, masterPlugins: [], recordDir,
  settings: { metronome: false, countIn: 0 }, groups: [], markers: [],
  tracks: [
    track("lane", [
      plugin("lane:tides", "studio_tidal_modulator", "instrument"),
      plugin(NODE, "studio_recorder", "audioFX"),
    ]),
    ...Array.from({ length: n === 0 ? 0 : EXTRA_TRACKS + (n % 2) }, (_, i) =>
      track(`heavy${i}`, [
        plugin(`heavy${i}:osc`, i % 2 ? "studio_macro_oscillator_2" : "studio_resonator", "instrument"),
        plugin(`heavy${i}:fx`, "studio_faust", "audioFX", { faustDsp: faust(n * 100 + i) }),
      ])),
  ],
});

type Take = { file: string; seconds: number; damaged: boolean };
let rec: { recording: boolean; seconds: number; takes: Take[] } | null = null;
let lastState = 0;
let worstGap = 0;
let applied = 0;
let lastApplied = 0;
const errors: string[] = [];

const ws = new WebSocket(url);
const send = (m: Record<string, unknown>) => ws.send(JSON.stringify({ ...m, session: SESSION }));
ws.on("message", (data: Buffer, isBinary: boolean) => {
  if (isBinary) return;
  const m = JSON.parse(String(data));
  if (m.type === "error") errors.push(String(m.message));
  if (m.type === "applied") {
    applied++;
    lastApplied = Date.now();
  }
  if (m.type !== "state" || m.session !== undefined && m.session !== SESSION) return;
  const now = Date.now();
  if (lastState > 0) worstGap = Math.max(worstGap, now - lastState);
  lastState = now;
  if (m.recorders?.[NODE]) rec = m.recorders[NODE];
});
ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Frames in a float32 stereo wav, read off its data chunk's header. */
function wavFrames(file: string): { frames: number; rate: number } {
  const b = readFileSync(file);
  let at = 12;
  let rate = 0;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === "fmt ") rate = b.readUInt32LE(at + 12);
    if (id === "data") return { frames: size / 8, rate };
    at += 8 + size + (size % 2);
  }
  return { frames: 0, rate };
}

ws.on("open", async () => {
  send({ type: "project", doc: doc(0) });
  await wait(2500);
  send({ type: "transport", action: "play" });
  await wait(1000);
  send({ type: "recorder", node: NODE, action: "record", on: true });
  await wait(1000);
  const started = Date.now();
  applied = 0;
  worstGap = 0;
  // One at a time, each once the last is applied: a burst would be superseded down to its last one.
  const deadline = Date.now() + 180_000;
  for (let n = 1; n <= BURST && Date.now() < deadline; n++) {
    send({ type: "project", doc: doc(n) });
    while (applied < n && Date.now() < deadline) await wait(50);
  }
  await wait(1000);
  send({ type: "project", doc: doc(0) });
  await wait(2000);
  send({ type: "recorder", node: NODE, action: "record", on: false });
  await wait(1000);
  const wall = (Date.now() - started) / 1000;
  send({ type: "transport", action: "stop" });
  send({ type: "drop-session" });

  const take = rec?.takes.at(-1);
  if (!take) {
    console.log(`FAIL — no take reported${errors.length ? `: ${errors.join("; ")}` : ""}`);
    process.exit(1);
  }
  const wav = existsSync(take.file) ? wavFrames(take.file) : { frames: 0, rate: 0 };
  const wavSeconds = wav.rate ? wav.frames / wav.rate : 0;
  console.log(`take          ${take.file}`);
  console.log(`reported      ${take.seconds.toFixed(2)} s, damaged=${take.damaged}`);
  console.log(`wav           ${wavSeconds.toFixed(2)} s at ${wav.rate} Hz`);
  console.log(`wall clock    ~${(wall + 1).toFixed(1)} s from the press to the stop; the rebuilds' graph swaps are not in the take`);
  console.log(`applied       ${applied} apply reply(ies) for ${BURST} documents`);
  console.log(`state frames  worst gap ${worstGap} ms — how long the message thread stalled`);
  const ok =
    !take.damaged &&
    wav.frames > 0 &&
    applied >= BURST &&
    Math.abs(wavSeconds - take.seconds) < 0.05 &&
    take.seconds > 0.5 * (wall + 1);
  console.log(ok ? "OK — the take is whole through the burst" : "FAIL");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
