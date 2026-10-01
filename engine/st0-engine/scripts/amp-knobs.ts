// amp-knobs.ts — does a conditioned amp model's KNOB reach the sound? Offline, no engine needed: one sawtooth
// through the amp plugin with `Knob n` at 0 and at 1, at the model's own rate and through the rate bridge.
//
//   npx tsx engine/st0-engine/scripts/amp-knobs.ts <model.json> [knob=1] [otherRate=44100]
//
// A knob the plugin forgets to feed leaves the model at its default and the two renders identical, which
// sounds like a model that "does not react much". The harmonic profiles must differ (docs/namPlugin.md).
// tests/data/ampmodel/proteus_lstm_8x2.json is a one-knob model with random weights: its knob moves a
// skip-connected residual, so expect a small figure (~0.08 dB), and exactly 0 for Knob 2, which it lacks.

import { renderAt } from "./nam-rate.ts";

const [model, knobArg = "1", otherArg = "44100"] = process.argv.slice(2);
if (!model) {
  console.error("usage: amp-knobs.ts <model.json> [knob=1] [otherRate=44100]");
  process.exit(2);
}
const knob = `Knob ${Number(knobArg)}`;
const other = Number(otherArg);

const meanDelta = (a: number[], b: number[]): number =>
  a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

// Wrapped, as nam-rate.ts is: this folder compiles to CommonJS, where a top-level await is refused.
async function main(): Promise<boolean> {
  let failed = false;
  for (const rate of [48000, other]) {
    const low = await renderAt(model, rate, { params: { [knob]: 0 } });
    const high = await renderAt(model, rate, { params: { [knob]: 1 } });
    const d = meanDelta(low, high);
    // A render is deterministic, so the floor is exactly 0: any difference is the knob, however small.
    console.log(`${rate} Hz  ${knob} 0 → 1  mean |Δ| over the harmonics ${d.toFixed(3)} dB`);
    if (!(d > 0.001)) failed = true;
  }
  console.log(failed ? `FAIL — ${knob} does not reach the sound` : `OK — ${knob} moves the sound`);
  return !failed;
}

main().then((ok) => process.exit(ok ? 0 : 1));
