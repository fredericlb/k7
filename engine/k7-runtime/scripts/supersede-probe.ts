// supersede-probe.ts — a burst of parameter writes and of documents still ends on the LAST one sent,
// and a fence between documents keeps its place. Point it at a running engine (docs/supersede.md).
//
//   npx tsx engine/k7-runtime/scripts/supersede-probe.ts [ws://127.0.0.1:8765]
//
// The bench is mix-probe's: a synth into a Volume & Pan at 0, so the level heard is the dry signal
// the @mix blend puts back — 0 is all of it, 0.5 is 3 dB under, 1 is silence. Count the
// "superseded" lines in the engine's log to see how many queued jobs were skipped.

import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:supersede-probe";
const BEATS = 1024;

const doc = (mix: number | null, name = "supersede-probe") => ({
  name,
  tempo: 120,
  sampleRate: 48000,
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
      id: "lane",
      name: "lane",
      role: "regular",
      contentType: "midi",
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
      clips: [
        {
          id: "held",
          type: "midi",
          name: "held",
          source: "",
          start: 0,
          length: BEATS,
          offset: 0,
          fadeIn: 0,
          fadeOut: 0,
          loopStart: 0,
          loopEnd: 0,
          notes: [{ time: 0, duration: BEATS, key: 57, vel: 0.9, channel: 1, rel: 0 }],
        },
      ],
      plugins: [
        {
          id: "lane:tides",
          type: "studio_tidal_modulator",
          name: "mu-tides",
          path: "",
          presetSave: "",
          role: "instrument",
          enabled: true,
          params: {},
        },
        {
          id: "lane:vol",
          type: "volume",
          name: "Volume & Pan",
          path: "",
          presetSave: "",
          role: "audioFX",
          enabled: true,
          params: { Volume: 0, ...(mix === null ? {} : { "@mix": mix }) },
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

let sum = 0;
let count = 0;
let playing: boolean | null = null;
const applied: string[] = [];
const rmsDb = () =>
  count ? 20 * Math.log10(Math.sqrt(sum / count) || 1e-9) : -Infinity;

ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
  if (!isBinary) {
    const m = JSON.parse(String(data));
    if (m.type === "state" && typeof m.playing === "boolean") playing = m.playing;
    if (m.type === "applied") applied.push(String(m.changes?.length ?? 0));
    return;
  }
  const buf =
    data instanceof ArrayBuffer
      ? data
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x4c535452) return;
  const channels = dv.getUint8(5);
  const frames = dv.getUint32(12, true);
  const all = new Float32Array(buf, 32, frames * channels);
  for (let i = 0; i < all.length; i++) sum += all[i] * all[i];
  count += all.length;
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const measure = async (settle = 1500) => {
  await wait(settle);
  sum = 0;
  count = 0;
  await wait(1000);
  return rmsDb();
};
const fmt = (db: number) => `${db.toFixed(1)} dBFS`;

ws.on("open", async () => {
  send({ type: "project", doc: doc(null) });
  send({ type: "broadcast", on: true });
  await wait(2500);
  send({ type: "transport", action: "play" });
  const set = (v: number) =>
    send({ type: "set-plugin-param", id: "lane:vol", name: "@mix", value: v });
  set(0);
  const dry = await measure();

  // 500 writes in one burst, as a dragged knob sends them, ending at 0.5.
  for (let i = 0; i < 499; i++) set(i % 2 ? 1 : 0.25);
  set(0.5);
  const knob = await measure();

  // 40 documents in one burst, as saves pile up behind a slow apply, ending at 0.5.
  set(0);
  for (let i = 0; i < 39; i++) send({ type: "project", doc: doc(i % 2 ? 1 : 0, `burst-${i}`) });
  send({ type: "project", doc: doc(0.5, "burst-last") });
  const docs = await measure(3000);

  // A fence keeps its place: document, stop, document — the stop lands and the transport stays stopped.
  applied.length = 0;
  send({ type: "project", doc: doc(1, "fence-a") });
  send({ type: "transport", action: "stop" });
  send({ type: "project", doc: doc(0.5, "fence-b") });
  await wait(2500);
  const fenced = applied.length;
  const stopped = playing === false;

  send({ type: "broadcast", on: false });
  send({ type: "drop-session" });

  console.log(`dry           ${fmt(dry)}`);
  console.log(`knob burst    ${fmt(knob)}  (want ${fmt(dry - 3)})`);
  console.log(`doc burst     ${fmt(docs)}  (want ${fmt(dry - 3)})`);
  console.log(`fence         ${fenced} applied (want 2), stopped=${stopped}`);
  const ok =
    dry > -40 &&
    Math.abs(knob - (dry - 3)) < 1 &&
    Math.abs(docs - (dry - 3)) < 1 &&
    fenced === 2 &&
    stopped;
  console.log(ok ? "OK — each burst ends on its last value, and the fence held" : "FAIL");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
