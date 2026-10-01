// own-mix-probe.ts — does the engine HOLD an effect's own dry/wet once it owns the blend? Point it
// at a running engine.
//
//   npx tsx engine/st0-engine/scripts/own-mix-probe.ts [ws://127.0.0.1:8765]
//
// A Reverb, whose own Wet Level rests at a third and Dry Level at a half, sent with `@mix`: its
// Wet Level must read 1 and its Dry Level 0, and a live set of either must be refused (docs/mix.md).

import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:own-mix-probe";
const ID = "fx:verb";

const doc = {
  name: "own-mix-probe",
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
      id: "fx",
      name: "fx",
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
          id: ID,
          type: "reverb",
          name: "Reverb",
          path: "",
          presetSave: "",
          role: "audioFX",
          enabled: true,
          params: { "@mix": 0.5 },
        },
      ],
      sends: [],
      automation: [],
    },
  ],
};

const ws = new WebSocket(url);
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let last: Record<string, number> | null = null;
ws.on("message", (data: Buffer, isBinary: boolean) => {
  if (isBinary) return;
  const m = JSON.parse(data.toString());
  if (m.type === "plugin-params" && m.id === ID && m.params) last = m.params;
});
ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

const read = async () => {
  last = null;
  send({ type: "get-plugin-params", id: ID });
  await wait(500);
  return last as Record<string, number> | null;
};

ws.on("open", async () => {
  send({ type: "project", doc });
  await wait(2000);
  const held = await read();
  // A knob on the plugin's own Wet Level: refused, so it must still read 1.
  send({ type: "set-plugin-param", id: ID, name: "Wet Level", value: 0.2 });
  await wait(300);
  const after = await read();
  send({ type: "drop-session" });

  const show = (p: Record<string, number> | null) =>
    p
      ? `Wet Level ${p["Wet Level"]?.toFixed(3)}, Dry Level ${p["Dry Level"]?.toFixed(3)}, @mix ${p["@mix"]}`
      : "no reply";
  console.log(`held         ${show(held)}`);
  console.log(`after a set  ${show(after)}`);
  const ok =
    held?.["Wet Level"] === 1 &&
    held?.["Dry Level"] === 0 &&
    after?.["Wet Level"] === 1;
  console.log(ok ? "OK — the engine holds the effect's own blend" : "ECHEC");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
