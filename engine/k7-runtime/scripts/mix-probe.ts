// mix-probe.ts — does the engine's @mix blend the DRY signal back around an effect? Point it at a
// running engine.
//
//   npx tsx engine/k7-runtime/scripts/mix-probe.ts [ws://127.0.0.1:8765]
//
// A synth plays into a Volume & Pan at 0: all wet is silence, so the level that comes out is the
// dry signal alone. Measured with no @mix, then at 0 (all dry), 0.5 (-3 dB) and 1 applied LIVE, as a
// knob sends them, then at 0.5 through the document and with it removed again. Between, waveform
// taps are opened on the module, which must not come between it and its pair (docs/mix.md).

import { pluginDoc } from "@studio/engine-protocol/build";
import { connect, fmtDb as fmt, heldNoteDoc, meter, TIDES, wait } from "./probe.ts";

const SESSION = "m9:mix-probe";

const doc = (mix: number | null) =>
  heldNoteDoc("mix-probe", [
    TIDES,
    // Silent when wet: its Volume at 0, so whatever comes out is the DRY signal the blend put back.
    pluginDoc({
      id: "lane:vol",
      type: "volume",
      name: "Volume & Pan",
      params: { Volume: 0, ...(mix === null ? {} : { "@mix": mix }) },
    }),
  ]);

const { ws, send, opened } = connect(SESSION);
const { measure } = meter(ws);

opened.then(async () => {
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
  // A client opens the module's waveform, both sides: the knob must still drive the SAME pair.
  for (const side of ["output", "input"])
    send({ type: "subscribe-waveform", id: "lane:vol", side });
  await wait(300);
  set(0);
  const tappedDry = await measure();
  set(0.5);
  const tappedHalf = await measure();
  for (const side of ["output", "input"])
    send({ type: "unsubscribe-waveform", id: "lane:vol", side });
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

  console.log(`no @mix   ${fmt(none)}`);
  console.log(`@mix 0    ${fmt(dry)}`);
  console.log(`@mix 0.5  ${fmt(half)}`);
  console.log(`tapped 0  ${fmt(tappedDry)}`);
  console.log(`tapped .5 ${fmt(tappedHalf)}`);
  console.log(`@mix 1    ${fmt(wet)}`);
  console.log(`doc 0.5   ${fmt(fromDoc)}`);
  console.log(`doc none  ${fmt(removed)}`);
  // All wet is the muted effect; all dry is the synth; half is 3 dB under the dry.
  const ok =
    none < dry - 30 &&
    wet < dry - 30 &&
    dry > -40 &&
    Math.abs(half - (dry - 3)) < 1 &&
    Math.abs(tappedDry - dry) < 1 &&
    Math.abs(tappedHalf - (dry - 3)) < 1 &&
    Math.abs(fromDoc - (dry - 3)) < 1 &&
    removed < dry - 30;
  console.log(ok ? "OK — the engine blends the dry signal back in" : "ECHEC");
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
});
