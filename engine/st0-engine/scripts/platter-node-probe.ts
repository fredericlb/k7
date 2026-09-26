// Throwaway: the two RUNTIME unknowns of docs/platter-node-plan.md, against the running engine.
//
//   npx tsx engine/st0-engine/scripts/platter-node-probe.ts [ws://127.0.0.1:8765]
//
// M2 — a platter DECLARED but holding no record: does it construct, does it warn, does it error?
// M3 — what a document re-send costs, split into the part `set-plugin-file` would remove and the
//      part it would not. Timed on the `applied` ack, which the engine sends after the diff.
//
// Its own session, dropped at the end, and `Rate: 0` throughout: nothing here should make a sound.

import { EngineClient } from "@studio/engine-client/engineClient";
import { writeWav } from "./platterBench";

const url = process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:platter-node-probe";

/** A short tone, just something real to decode — the CONTENT is irrelevant here. */
function tone(seconds: number, hz: number, tag: string): string {
  const rate = 48000;
  const pcm = new Int16Array(Math.round(rate * seconds));
  for (let i = 0; i < pcm.length; i++)
    pcm[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12000);
  return writeWav(pcm, rate, tag);
}

/** The smallest document carrying one platter — `deckFile` omitted entirely when there is none.
 *
 * `extraTracks` are FILLER and their record never changes: the question is what a bigger DOCUMENT
 * costs to ship and diff, not what replacing twenty plugins costs. Conflating those was the first
 * version of this script, and it answered a question nobody asked. */
function doc(deckFile?: string, extraTracks = 0, fillerFile?: string) {
  const platterTrack = (id: string, file?: string) => ({
    id,
    name: id,
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
        id: `${id}:platter`,
        type: "studio_turntable",
        name: "platter",
        path: "",
        ...(file ? { deckFile: file } : {}),
        presetSave: "",
        // The question of measurement 1, left EMPTY on purpose — see the plan.
        role: "",
        enabled: true,
        // Stopped: this probe must not make a sound on somebody's monitors.
        params: { Rate: 0, Seek: 0, Gain: 1 },
      },
    ],
    sends: [],
    automation: [],
  });
  return {
    name: "platter-probe",
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
      platterTrack("deckA", deckFile),
      ...Array.from({ length: extraTracks }, (_, i) =>
        platterTrack(`filler${i}`, fillerFile),
      ),
    ],
  };
}

const c = new EngineClient(url, SESSION);
const warnings: string[] = [];
const errors: string[] = [];
c.on("warning", (w: unknown) => warnings.push(JSON.stringify(w)));
c.on("error", (e: unknown) => errors.push(String(e)));

/** Send a document and wait for the engine's `applied` — the ack that follows the diff. */
function apply(d: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const to = setTimeout(() => reject(new Error("no `applied` in 15 s")), 15_000);
    c.once("applied", () => {
      clearTimeout(to);
      resolve(performance.now() - t0);
    });
    c.sendProject(d as never);
  });
}

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x: number) => `${x.toFixed(1)} ms`;

async function main() {
  c.connect();
  await new Promise((r) => setTimeout(r, 1500));

  // ---- M2 : a platter with NO record -------------------------------------------------------
  console.log("=== M2 — un plateau DÉCLARÉ sans disque ===");
  warnings.length = 0;
  errors.length = 0;
  const empty = await apply(doc());
  await new Promise((r) => setTimeout(r, 1200)); // let any late warning land
  console.log(`  applied in ${ms(empty)}`);
  console.log(`  warnings: ${warnings.length ? warnings.join(" | ") : "aucun"}`);
  console.log(`  errors:   ${errors.length ? errors.join(" | ") : "aucun"}`);

  // ---- M3 : what a re-send costs -----------------------------------------------------------
  console.log("\n=== M3 — ce que coûte un renvoi de document ===");
  const a = tone(8, 220, "rec-a");
  const b = tone(8, 330, "rec-b");

  const cold = await apply(doc(a));
  console.log(`  premier disque (décodage compris) : ${ms(cold)}`);

  const same: number[] = [];
  for (let i = 0; i < 7; i++) same.push(await apply(doc(a)));
  console.log(
    `  renvoi IDENTIQUE (rien ne change)  : ${ms(med(same))}  [${same.map((x) => x.toFixed(0)).join(", ")}]`,
  );

  const swap: number[] = [];
  for (let i = 0; i < 7; i++) swap.push(await apply(doc(i % 2 ? a : b)));
  console.log(
    `  poser un AUTRE disque              : ${ms(med(swap))}  [${swap.map((x) => x.toFixed(0)).join(", ")}]`,
  );

  // …and the same on a document the SIZE of a real set, with ONE platter changing. The gap between
  // this and the line above is what scales with the document rather than with the record — which is
  // exactly, and only, what `set-plugin-file` would remove.
  const filler = tone(4, 440, "filler");
  // Warm it first, so the fillers' own decode is not counted in the first timed round.
  await apply(doc(a, 15, filler));
  const big: number[] = [];
  for (let i = 0; i < 7; i++) big.push(await apply(doc(i % 2 ? a : b, 15, filler)));
  console.log(
    `  UN disque, document de 16 pistes   : ${ms(med(big))}  [${big.map((x) => x.toFixed(0)).join(", ")}]`,
  );

  // The floor of that: the same 16-track document re-sent with nothing changed at all.
  const bigSame: number[] = [];
  for (let i = 0; i < 7; i++) bigSame.push(await apply(doc(a, 15, filler)));
  console.log(
    `  …renvoi identique, 16 pistes       : ${ms(med(bigSame))}  [${bigSame.map((x) => x.toFixed(0)).join(", ")}]`,
  );

  c.close();
  process.exit(0);
}

void main();
