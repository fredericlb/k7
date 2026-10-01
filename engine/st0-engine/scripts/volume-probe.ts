// volume-probe.ts — does the engine's stage set a module's INPUT and OUTPUT level? Point it at a
// running engine.
//
//   npx tsx engine/st0-engine/scripts/volume-probe.ts [ws://127.0.0.1:8765]
//
// A synth into a Volume & Pan: the synth's @output-volume at -6 dB (an instrument: no input, an
// output stage alone), then the effect's @input-volume at -12 dB, then its @output-volume at +6
// on top — each measured against the level before it (docs/mix.md).

import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:volume-probe";
const RATE = 48000;
const HELD_BEATS = 512;

const doc = () => ({
  name: "volume-probe",
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
          length: HELD_BEATS,
          offset: 0,
          fadeIn: 0,
          fadeOut: 0,
          loopStart: 0,
          loopEnd: 0,
          notes: [
            { time: 0, duration: HELD_BEATS, key: 57, vel: 0.9, channel: 1, rel: 0 },
          ],
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
          // At its own default: only the stage's levels move what comes out.
          id: "lane:vol",
          type: "volume",
          name: "Volume & Pan",
          path: "",
          presetSave: "",
          role: "audioFX",
          enabled: true,
          params: {},
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
const reset = () => {
  sum = 0;
  count = 0;
};
const rmsDb = () =>
  count ? 20 * Math.log10(Math.sqrt(sum / count) || 1e-9) : -Infinity;

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
  for (let i = 0; i < all.length; i++) sum += all[i] * all[i];
  count += all.length;
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const measure = async () => {
  await wait(700);
  reset();
  await wait(1000);
  return rmsDb();
};

ws.on("open", async () => {
  send({ type: "project", doc: doc() });
  send({ type: "broadcast", on: true });
  await wait(2500);
  send({ type: "transport", action: "play" });
  const set = (id: string, name: string, value: number) =>
    send({ type: "set-plugin-param", id, name, value });
  const base = await measure();
  set("lane:tides", "@output-volume", -6);
  const synthOut = await measure();
  set("lane:vol", "@input-volume", -12);
  const fxIn = await measure();
  set("lane:vol", "@output-volume", 6);
  const fxOut = await measure();
  send({ type: "transport", action: "stop" });
  send({ type: "broadcast", on: false });
  send({ type: "drop-session" });

  const fmt = (db: number) => `${db.toFixed(1)} dBFS`;
  console.log(`as it is                  ${fmt(base)}`);
  console.log(`synth @output-volume -6   ${fmt(synthOut)}  (${(synthOut - base).toFixed(1)} dB)`);
  console.log(`fx @input-volume -12      ${fmt(fxIn)}  (${(fxIn - synthOut).toFixed(1)} dB)`);
  console.log(`fx @output-volume +6      ${fmt(fxOut)}  (${(fxOut - fxIn).toFixed(1)} dB)`);
  const near = (x: number, want: number) => Math.abs(x - want) < 0.5;
  const ok =
    base > -40 &&
    near(synthOut - base, -6) &&
    near(fxIn - synthOut, -12) &&
    near(fxOut - fxIn, 6);
  console.log(ok ? "OK — the stage sets both levels" : "ECHEC");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
