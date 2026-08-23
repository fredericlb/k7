// master-chain.ts — does the song's MIX -> OUT run actually reach the SOUND?
//
// Renders one note three times, changing nothing but `masterPlugins` and then `masterVolume`, and
// measures the peak of each. No TypeScript test can see this: the compiler's own suite proves the
// document, and the C++ suite proves the diff, but neither proves the plugin ended up on the
// master bus — nor that an offline render applies the OUT node's level at all, which for a while
// it did not.
//   npx tsx engine/moteur/scripts/master-chain.ts
// See packages/song/docs/masterChain.md and docs/masterVolume.md.

import { execFileSync } from "node:child_process";
import { findEngineBinary } from "../../../packages/engine-client/src/engineBinary.ts";
import { renderProject } from "../../../packages/file-service/src/render.ts";

/** Two seconds of a 4OSC note — loud, and identical in both renders. */
const base = {
  name: "master-chain",
  tempo: 120,
  sampleRate: 48000,
  timeSigNumerator: 4,
  timeSigDenominator: 4,
  masterVolume: 0,
  recordDir: "",
  settings: { metronome: false, countIn: 0 },
  groups: [],
  tracks: [
    {
      id: "t1",
      name: "synth",
      clips: [
        {
          id: "c1",
          type: "midi",
          name: "t",
          start: 0,
          length: 2,
          notes: [{ time: 0, duration: 2, key: 45, vel: 0.8, channel: 1 }],
        },
      ],
      plugins: [
        { id: "t1:synth", type: "4osc", name: "synth", role: "instrument" },
      ],
    },
  ],
};

/** The file's true peak in dBFS, from the engine's own --peak (which answers JSON). */
function peakDb(bin: string, file: string): number {
  const out = execFileSync(bin, ["--peak", file], { encoding: "utf8" });
  return (JSON.parse(out) as { peakDb: number }).peakDb;
}

async function main() {
  const bin = findEngineBinary();
  if (!bin) throw new Error("no studio-moteur binary on this machine");

  const bare = await renderProject({ ...base, masterPlugins: [] });
  // Tracktion's own volume plugin, pinned to the bottom of its fader. Silence is the one
  // outcome that cannot be a coincidence: nothing else in this document touches the level.
  const withChain = await renderProject({
    ...base,
    masterPlugins: [
      {
        id: "m1",
        type: "volume",
        name: "trim",
        role: "audioFX",
        // `Volume`, capitalised — the name the plugin publishes (builtinParams.generated.ts).
        // 0 is the bottom of the fader; a lowercase key matches nothing and changes nothing,
        // which is exactly what a first run of this script measured.
        params: { Volume: 0 },
      },
    ],
  });

  // …and the OUT node's own Volume, with no chain at all. A plain -20 dB, which a peak can be
  // checked against by arithmetic rather than by margin: this is a gain, not a fader curve.
  const TRIM_DB = -20;
  const trimmed = await renderProject({
    ...base,
    masterVolume: TRIM_DB,
    masterPlugins: [],
  });

  const a = peakDb(bin, bare.files[0]);
  const b = peakDb(bin, withChain.files[0]);
  const c = peakDb(bin, trimmed.files[0]);
  console.log(`sans chaîne master   : ${a.toFixed(1)} dBFS`);
  console.log(`avec                 : ${b.toFixed(1)} dBFS`);
  console.log(`OUT Volume ${TRIM_DB} dB   : ${c.toFixed(1)} dBFS`);

  // The bare render has to make a sound, or the comparison proves nothing about the chain.
  const audible = a > -40;
  // …and the chained one has to be far below it. A margin rather than exact silence: the
  // fader's own curve is what decides the floor, and this asks whether the plugin RAN.
  const silenced = b < a - 40;
  // The trimmed one lands exactly TRIM_DB below the bare one. Within half a dB, which is
  // rounding rather than slack: MasterGainPlugin takes dB straight to a linear factor with no
  // curve, so anything looser would also pass on a render that ignored the field and clipped.
  const trimApplied = Math.abs(c - (a + TRIM_DB)) < 0.5;
  const ok = audible && silenced && trimApplied;
  console.log(
    ok
      ? "OK — la chaîne master ET le niveau de sortie sont sur le bus"
      : `ECHEC — audible=${audible} silenced=${silenced} trim=${trimApplied}`,
  );
  process.exit(ok ? 0 : 1);
}

void main();
