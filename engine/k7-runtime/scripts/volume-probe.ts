// volume-probe.ts — does the engine's stage set a module's INPUT and OUTPUT level? Point it at a
// running engine.
//
//   npx tsx engine/k7-runtime/scripts/volume-probe.ts [ws://127.0.0.1:8765]
//
// A synth into a Volume & Pan: the synth's @output-volume at -6 dB (an instrument: no input, an
// output stage alone), then the effect's @input-volume at -12 dB, then its @output-volume at +6
// on top — each measured against the level before it (docs/mix.md).

import { pluginDoc } from "@studio/engine-protocol/build";
import { connect, fmtDb as fmt, heldNoteDoc, meter, TIDES, wait } from "./probe.ts";

const SESSION = "m9:volume-probe";

const doc = () =>
  heldNoteDoc("volume-probe", [
    TIDES,
    // At its own default: only the stage's levels move what comes out.
    pluginDoc({ id: "lane:vol", type: "volume", name: "Volume & Pan" }),
  ]);

const { ws, send, opened } = connect(SESSION);
const { measure } = meter(ws);

opened.then(async () => {
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
