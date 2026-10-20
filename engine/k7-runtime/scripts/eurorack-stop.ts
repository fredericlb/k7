// eurorack-stop.ts — does a Mutable Instruments module let go of its notes on a STOP, and on a
// PANIC? Point it at a running engine.
//
//   npx tsx engine/k7-runtime/scripts/eurorack-stop.ts [ws://127.0.0.1:8765]
//
// One MIDI lane plays mu-tides with a note far longer than the run, so no note-off ever arrives.
// The level is read while it plays, then a second after a stop, then a second after a panic that
// follows a fresh play. A module that ignores `midiPanic()` holds the note through both
// (docs/panic.md). What it cannot say is how it SOUNDS — only that the level falls.

import { connect, fmtDb as fmt, heldNoteDoc, meter, TIDES, wait } from "./probe.ts";

const SESSION = "m9:eurorack-stop";

/** The held note outlasts the run: the note-off is never reached, which is the case a stop has to cover. */
const doc = () => heldNoteDoc("eurorack-stop", [TIDES]);

const { ws, send, opened } = connect(SESSION);
const { reset, rmsDb } = meter(ws);

opened.then(async () => {
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

  console.log(`playing       ${fmt(playing)}`);
  console.log(`after stop    ${fmt(afterStop)}`);
  console.log(`after panic   ${fmt(afterPanic)}`);
  // 40 dB under the note is silence for this question; a held note sits within a few dB of it.
  const ok =
    playing > -40 && afterStop < playing - 40 && afterPanic < playing - 40;
  console.log(ok ? "OK — the note is let go" : "ECHEC — the note is still held");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
