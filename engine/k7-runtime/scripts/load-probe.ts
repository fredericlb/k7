// load-probe.ts — does the engine REPORT what its plugins cost? Point it at a running engine.
//
//   npx tsx engine/k7-runtime/scripts/load-probe.ts [ws://127.0.0.1:8765]
//
// One MIDI lane plays mu-tides; while it plays, the state frames' `load` is read: the plugin's
// share of the audio block, and the process's memory. A frame carries it one time in four
// (docs/load.md), so a second of frames holds several.

import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:load-probe";
const RATE = 48000;
const HELD_BEATS = 512;

const doc = () => ({
  name: "load-probe",
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
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));

type Load = { plugins: Record<string, { cpu: number; bytes?: number }>; process?: number };
const seen: Load[] = [];
let frames = 0;

ws.on("message", (data: Buffer, isBinary: boolean) => {
  if (isBinary) return;
  const msg = JSON.parse(data.toString());
  if (msg.type !== "state" || msg.session !== SESSION) return;
  frames++;
  if (msg.load) seen.push(msg.load);
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

ws.on("open", async () => {
  send({ type: "project", doc: doc() });
  await wait(2500);
  send({ type: "transport", action: "play" });
  await wait(1000);
  seen.length = 0;
  frames = 0;
  await wait(2000);
  send({ type: "transport", action: "stop" });
  send({ type: "drop-session" });

  const last = seen.at(-1);
  const tides = last?.plugins["lane:tides"];
  console.log(`${frames} state frames, ${seen.length} with a load report`);
  console.log(`plugins reported: ${Object.keys(last?.plugins ?? {}).join(", ") || "none"}`);
  console.log(`mu-tides cpu: ${tides ? (tides.cpu * 100).toFixed(2) + "%" : "absent"}`);
  console.log(`process memory: ${last?.process ? (last.process / 2 ** 20).toFixed(0) + " MB" : "absent"}`);
  const ok = seen.length > 0 && !!tides && tides.cpu > 0 && (last?.process ?? 0) > 0;
  console.log(ok ? "OK — the load is reported" : "ECHEC — no load, or a zero one");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
