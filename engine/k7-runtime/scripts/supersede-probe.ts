// supersede-probe.ts — a burst of parameter writes and of documents still ends on the LAST one sent,
// and a fence between documents keeps its place. Point it at a running engine (docs/supersede.md).
//
//   npx tsx engine/k7-runtime/scripts/supersede-probe.ts [ws://127.0.0.1:8765]
//
// The bench is mix-probe's: a synth into a Volume & Pan at 0, so the level heard is the dry signal
// the @mix blend puts back — 0 is all of it, 0.5 is 3 dB under, 1 is silence. Count the
// "superseded" lines in the engine's log to see how many queued jobs were skipped.

import { pluginDoc } from "@studio/engine-protocol/build";
import { connect, fmtDb as fmt, heldNoteDoc, meter, TIDES, wait } from "./probe.ts";

const SESSION = "m9:supersede-probe";
const BEATS = 1024;

const doc = (mix: number | null, name = "supersede-probe") =>
  heldNoteDoc(
    name,
    [
      TIDES,
      pluginDoc({
        id: "lane:vol",
        type: "volume",
        name: "Volume & Pan",
        params: { Volume: 0, ...(mix === null ? {} : { "@mix": mix }) },
      }),
    ],
    BEATS,
  );

const { ws, send, opened } = connect(SESSION);
const { measure: measureLevel } = meter(ws);

let playing: boolean | null = null;
const applied: string[] = [];

ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
  if (isBinary) return;
  const m = JSON.parse(String(data));
  if (m.type === "state" && typeof m.playing === "boolean") playing = m.playing;
  if (m.type === "applied") applied.push(String(m.changes?.length ?? 0));
});

const measure = (settle = 1500) => measureLevel(settle);

opened.then(async () => {
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
