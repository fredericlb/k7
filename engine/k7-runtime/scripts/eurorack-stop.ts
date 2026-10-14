// eurorack-stop.ts — does a Mutable Instruments module let go of its notes on a STOP, and on a
// PANIC? Point it at a running engine.
//
//   npx tsx engine/k7-runtime/scripts/eurorack-stop.ts [ws://127.0.0.1:8765]
//
// One MIDI lane plays mu-tides with a note far longer than the run, so no note-off ever arrives.
// The level is read while it plays, then a second after a stop, then a second after a panic that
// follows a fresh play. A module that ignores `midiPanic()` holds the note through both
// (docs/panic.md). What it cannot say is how it SOUNDS — only that the level falls.

import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:eurorack-stop";
const RATE = 48000;
/** Far longer than the run: the note-off is never reached, which is the case a stop has to cover. */
const HELD_BEATS = 512;

const doc = () => ({
  name: "eurorack-stop",
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

/** The RMS of every broadcast frame since the last `reset`, so each phase measures only itself. */
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

ws.on("open", async () => {
  send({ type: "project", doc: doc() });
  send({ type: "broadcast", on: true });
  // The first apply builds the plugin, seconds long on a cold engine.
  await wait(2500);

  send({ type: "transport", action: "play" });
  await wait(1500);
  reset();
  await wait(1000);
  const playing = rmsDb();

  send({ type: "transport", action: "stop" });
  // Past the default 0.3 s release: whatever is left is a note still held.
  await wait(1000);
  reset();
  await wait(1000);
  const afterStop = rmsDb();

  send({ type: "transport", action: "play" });
  await wait(1500);
  send({ type: "transport", action: "panic" });
  await wait(1000);
  reset();
  await wait(1000);
  const afterPanic = rmsDb();

  send({ type: "broadcast", on: false });
  send({ type: "drop-session" });

  const fmt = (db: number) => `${db.toFixed(1)} dBFS`;
  console.log(`playing       ${fmt(playing)}`);
  console.log(`after stop    ${fmt(afterStop)}`);
  console.log(`after panic   ${fmt(afterPanic)}`);
  // 40 dB under the note is silence for this question; a held note sits within a few dB of it.
  const ok =
    playing > -40 && afterStop < playing - 40 && afterPanic < playing - 40;
  console.log(ok ? "OK — the note is let go" : "ECHEC — the note is still held");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
