// mix-probe.ts — does the engine's @mix blend the DRY signal back around an effect? Point it at a
// running engine.
//
//   npx tsx engine/st0-engine/scripts/mix-probe.ts [ws://127.0.0.1:8765]
//
// A synth plays into a Volume & Pan at 0: all wet is silence, so the level that comes out is the
// dry signal alone. Measured with no @mix, then at 0 (all dry), 0.5 (-3 dB) and 1 applied LIVE, as a
// knob sends them, then at 0.5 through the document and with it removed again (docs/mix.md).

import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:mix-probe";
const RATE = 48000;
const HELD_BEATS = 512;

const doc = (mix: number | null) => ({
  name: "mix-probe",
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
          // Silent when wet: its Volume at 0, so whatever comes out is the DRY signal the blend put back.
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
  send({ type: "project", doc: doc(null) });
  send({ type: "broadcast", on: true });
  await wait(2500);
  send({ type: "transport", action: "play" });
  const none = await measure();
  const set = (v: number) =>
    send({ type: "set-plugin-param", id: "lane:vol", name: "@mix", value: v });
  set(0);
  const dry = await measure();
  set(0.5);
  const half = await measure();
  set(1);
  const wet = await measure();
  // The same through the DOCUMENT, as a `mix:` edit in the module file reaches it: set, then removed.
  send({ type: "project", doc: doc(0.5) });
  const fromDoc = await measure();
  send({ type: "project", doc: doc(null) });
  const removed = await measure();
  send({ type: "transport", action: "stop" });
  send({ type: "broadcast", on: false });
  send({ type: "drop-session" });

  const fmt = (db: number) => `${db.toFixed(1)} dBFS`;
  console.log(`no @mix   ${fmt(none)}`);
  console.log(`@mix 0    ${fmt(dry)}`);
  console.log(`@mix 0.5  ${fmt(half)}`);
  console.log(`@mix 1    ${fmt(wet)}`);
  console.log(`doc 0.5   ${fmt(fromDoc)}`);
  console.log(`doc none  ${fmt(removed)}`);
  // All wet is the muted effect; all dry is the synth; half is 3 dB under the dry.
  const ok =
    none < dry - 30 &&
    wet < dry - 30 &&
    dry > -40 &&
    Math.abs(half - (dry - 3)) < 1 &&
    Math.abs(fromDoc - (dry - 3)) < 1 &&
    removed < dry - 30;
  console.log(ok ? "OK — the engine blends the dry signal back in" : "ECHEC");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
