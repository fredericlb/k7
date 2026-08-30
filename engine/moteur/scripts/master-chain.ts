// master-chain.ts — does the song's MIX -> OUT run actually reach the SOUND?
//
// Renders one note three times, changing nothing but `masterPlugins` and then `masterVolume`, and
// measures the peak of each. No TypeScript test can see this: the compiler's own suite proves the
// document, and the C++ suite proves the diff, but neither proves the plugin ended up on the
// master bus, nor that an offline render applies the OUT node's level at all.
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
  if (!bin) throw new Error("no st0-engine binary on this machine");

  const bare = await renderProject({ ...base, masterPlugins: [] });
  // Tracktion's own volume plugin, pinned to the BOTTOM of its fader (../docs/renderHarnesses.md).
  const withChain = await renderProject({
    ...base,
    masterPlugins: [
      {
        id: "m1",
        type: "volume",
        name: "trim",
        role: "audioFX",
        // `Volume`, capitalised: a lowercase key matches nothing (../docs/renderHarnesses.md).
        params: { Volume: 0 },
      },
    ],
  });

  // …and the OUT node's own Volume with no chain: a gain, not a fader curve, so arithmetic holds.
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
  // …and the chained one far below it — a MARGIN, since the question is whether the plugin ran.
  const silenced = b < a - 40;
  // Exactly TRIM_DB below the bare one, to half a dB of ROUNDING (../docs/renderHarnesses.md).
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
