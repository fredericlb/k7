// load-probe.ts — does the engine REPORT what its plugins cost? Point it at a running engine.
//
//   npx tsx engine/k7-runtime/scripts/load-probe.ts [ws://127.0.0.1:8765]
//
// One MIDI lane plays mu-tides; while it plays, the state frames' `load` is read: the plugin's
// share of the audio block, and the process's memory. A frame carries it one time in four
// (docs/load.md), so a second of frames holds several.

import { connect, heldNoteDoc, TIDES, wait } from "./probe.ts";

const SESSION = "m9:load-probe";

const doc = () => heldNoteDoc("load-probe", [TIDES]);

const { ws, send, opened } = connect(SESSION);

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

opened.then(async () => {
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
