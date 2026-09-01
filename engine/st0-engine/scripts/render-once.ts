// render-once.ts — the offline bounce through the SAME renderProject the /render route
// calls, so this proves the wrapper and not just the CLI. No engine needs to be running:
// a render opens no audio device, which is the whole reason it can't collide with one.
//   npx tsx engine/st0-engine/scripts/render-once.ts

import { statSync } from "node:fs";
import { renderProject } from "../../../packages/file-service/src/render.ts";

const doc = {
  name: "bounce",
  tempo: 120,
  sampleRate: 48000,
  timeSigNumerator: 4,
  timeSigDenominator: 4,
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

async function main() {
  const out = await renderProject(doc);
  const bytes = out.files.map((f) => statSync(f).size);
  console.log("fichiers :", out.files);
  console.log("octets   :", bytes);
  // Hundreds of kB for two seconds: what this excludes is "wrote a 44-byte header and no samples".
  const ok = bytes.length === 1 && bytes[0] > 100_000;
  console.log(
    ok ? "OK — le rendu produit de l'audio" : "ECHEC — fichier trop petit",
  );
  process.exit(ok ? 0 : 1);
}

void main();
