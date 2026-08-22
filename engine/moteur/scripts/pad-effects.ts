// pad-effects.ts — proves a step sequencer PAD's two effects reach the SOUND, by rendering and
// counting hits. `repeat` retriggers a pad inside its own step; `skip` silences it on every nth
// pass of the pattern. Both are realised by the engine (EditBuilder's insertMidiClip), so a render
// is the only thing that can say whether they happened.
//   npx tsx engine/moteur/scripts/pad-effects.ts

import { readFileSync, rmSync } from "node:fs";
import { renderProject } from "../../../packages/file-service/src/render.ts";

const RATE = 48000;
const TEMPO = 120; // 2 beats per second — a beat is 0.5s, and a 1/4-note pad's step is one beat
// C5, not a kick-range C2: the envelope below is measured over 5ms windows, and a 65 Hz tone's
// period is longer than that — the measurement, not the music, chooses this.
const KEY = 72;
const PASSES = 4;
const WIN = 4; // beats per pass: one 4/4 bar, with a pad on each of its four beats
// A pad's own length, and so what `repeat` divides. A whole beat, which puts a ×4 ratchet's hits
// 125ms apart — far enough that the refractory window below can be long enough to swallow the
// second reading of one attack without swallowing a real hit.
const PAD_DUR = 1;

interface Wav {
  rate: number;
  mono: Float32Array;
}

/** Enough of a wav reader for what the engine writes: PCM 16/24/32 or float32, any chunk order. */
function readWav(path: string): Wav {
  const b = readFileSync(path);
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let format = 1;
  let mono = new Float32Array(0);
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString("ascii", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === "fmt ") {
      format = b.readUInt16LE(i + 8);
      channels = b.readUInt16LE(i + 10);
      rate = b.readUInt32LE(i + 12);
      bits = b.readUInt16LE(i + 22);
    } else if (id === "data") {
      const bytes = bits / 8;
      const frames = Math.floor(size / (bytes * channels));
      mono = new Float32Array(frames);
      for (let n = 0; n < frames; n++) {
        const o = i + 8 + n * bytes * channels;
        let s = 0;
        if (format === 3) s = b.readFloatLE(o);
        else if (bits === 16) s = b.readInt16LE(o) / 32768;
        else if (bits === 24)
          s = ((b[o] | (b[o + 1] << 8) | ((b[o + 2] << 24) >> 8)) << 8) / 2147483648;
        else if (bits === 32) s = b.readInt32LE(o) / 2147483648;
        mono[n] = s;
      }
      break;
    }
    i += 8 + size + (size % 2);
  }
  return { rate, mono };
}

/**
 * Where each note ATTACKS, in seconds — found by the RISE, not by a gate.
 *
 * A gate on the envelope only finds a hit that was preceded by silence, and a synth's release runs
 * into the next note: the first version of this counted 2 attacks in a bar of 16 and read as a
 * broken engine. What every hit does have is a sharp front, so an attack is a frame several times
 * louder than the one before it, with a refractory window so one onset is not counted twice.
 *
 * Counting attacks rather than measuring an envelope, because what both effects change is HOW MANY
 * there are and WHEN: a ratchet is four hits where there was one, a skip is three passes of four.
 */
const HOP_MS = 5;

function attacks(w: Wav): number[] {
  const hop = Math.round((w.rate * HOP_MS) / 1000);
  // RMS per hop, not peak: a PEAK envelope tracks the waveform itself, so a sustained tone makes
  // it wobble once per period — at 65 Hz that is a rise every 15ms, and the flux below counted 28
  // attacks in a bar of 4. RMS over a window longer than the period is flat while a note holds,
  // which is the whole property this measurement rests on. (The pitch is high for the same
  // reason: see KEY.)
  const env: number[] = [];
  for (let n = 0; n + hop <= w.mono.length; n += hop) {
    let sum = 0;
    for (let k = 0; k < hop; k++) sum += w.mono[n + k] * w.mono[n + k];
    env.push(Math.sqrt(sum / hop));
  }
  const loudest = Math.max(...env);
  /**
   * Each ISLAND of energy is one hit — a Schmitt trigger, not an onset heuristic.
   *
   * The synth is given a 30ms percussive envelope above precisely so this can be the measurement:
   * every hit is loud, then silent, and counting them needs no judgement about what an "attack"
   * looks like. The two thresholds are far apart so a decay tail crossing back and forth cannot
   * ring the trigger twice.
   */
  const HIGH = loudest * 0.3;
  const LOW = loudest * 0.05;
  const out: number[] = [];
  let armed = true;
  for (let f = 0; f < env.length; f++) {
    if (armed && env[f] > HIGH) {
      out.push((f * hop) / w.rate);
      armed = false;
    } else if (!armed && env[f] < LOW) armed = true;
  }
  return out;
}

/** A one-bar pattern of four pads, looped `PASSES` times, with `note` merged into the first pad. */
function docFor(note: Record<string, unknown>): unknown {
  const notes = [0, 1, 2, 3].map((b) => ({
    time: b,
    duration: PAD_DUR,
    key: KEY,
    vel: 1,
    channel: 0,
    rel: 1,
    ...(b === 0 ? note : {}),
  }));
  return {
    name: "pad-effects",
    tempo: TEMPO,
    sampleRate: RATE,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    recordDir: "",
    settings: { metronome: false, countIn: 0 },
    groups: [],
    tracks: [
      {
        id: "t1",
        name: "drums",
        clips: [
          {
            id: "c1",
            type: "midi",
            name: "pat",
            start: 0,
            // The shape a looped sequence compiles to: the window as the loop range, and the
            // length as that window times the passes.
            length: WIN * PASSES,
            offset: 0,
            fadeIn: 0,
            fadeOut: 0,
            loopStart: 0,
            loopEnd: WIN,
            notes,
          },
        ],
        plugins: [
          {
            id: "t1:synth",
            type: "4osc",
            name: "synth",
            role: "instrument",
            /**
             * A PERCUSSIVE amp envelope, and it is the measurement that asks for it.
             *
             * On the default patch a note rings for ~350ms and its release runs into the next hit,
             * so there is no silence between the four hits of a ratchet and no reliable way to
             * count them: every onset heuristic tried against that tail either missed hits or
             * doubled them. A 30ms blip that decays to nothing makes each hit an ISLAND of energy
             * with real silence around it, and counting islands needs no heuristic at all.
             */
            params: {
              "Amp Attack": 0.001,
              "Amp Decay": 0.03,
              "Amp Sustain": 0,
              "Amp Release": 0.001,
            },
          },
        ],
      },
    ],
  };
}

/** How many attacks land inside pass `p` — which is what `skip` changes. */
const inPass = (hits: number[], p: number): number => {
  const secs = (WIN * 60) / TEMPO;
  return hits.filter((t) => t >= p * secs - 0.05 && t < (p + 1) * secs - 0.05)
    .length;
};

async function main(): Promise<void> {
  const run = async (label: string, note: Record<string, unknown>) => {
    const out = await renderProject(docFor(note));
    const hits = attacks(readWav(out.files[0]));
    rmSync(out.dir, { recursive: true, force: true });
    const perPass = [0, 1, 2, 3].map((p) => inPass(hits, p));
    console.log(
      `${label.padEnd(22)} total ${String(hits.length).padStart(2)}  par passe [${perPass.join(", ")}]`,
    );
    return { hits, perPass };
  };

  let ok = true;
  const check = (what: string, pass: boolean) => {
    if (!pass) ok = false;
    console.log(`   ${pass ? "OK  " : "ECHEC"} ${what}`);
  };

  // The baseline every comparison below is against: four pads, four passes, sixteen hits.
  const base = await run("sans effet", {});
  check("16 frappes, 4 par passe", base.perPass.every((n) => n === 4));

  /**
   * A ratchet on the FIRST pad only: it should become four hits inside its own step, so a pass
   * gains three. The other three pads must be untouched — an effect that leaked onto its
   * neighbours would still raise the total and would still look right in a count alone.
   */
  const rep = await run("repeat x4", { repeat: 4 });
  check("7 frappes par passe (4 + 3)", rep.perPass.every((n) => n === 7));
  {
    // The four hits divide the PAD's own length, which is what "in the available time for the
    // pad" means: they must not run past it into the next step.
    const want = ((PAD_DUR / 4) * 60) / TEMPO;
    const first4 = rep.hits.slice(0, 4);
    const spacing = first4.slice(1).map((t, i) => t - first4[i]);
    check(
      `les 4 frappes divisent le pas (${spacing.map((s) => s.toFixed(3)).join(" ")} ≈ ${want.toFixed(3)})`,
      spacing.length === 3 && spacing.every((s) => Math.abs(s - want) < 0.01),
    );
  }

  // Silent on every 2nd pass: passes 1 and 3 keep their four, passes 2 and 4 lose the first pad.
  const s2 = await run("skip 2", { skip: 2 });
  check("passes [4, 3, 4, 3]", JSON.stringify(s2.perPass) === "[4,3,4,3]");

  // …and on every 4th: only the last pass loses it.
  const s4 = await run("skip 4", { skip: 4 });
  check("passes [4, 4, 4, 3]", JSON.stringify(s4.perPass) === "[4,4,4,3]");

  // Both at once, on one pad: the ratchet plays where the pad is not skipped, and nothing at all
  // where it is. This is the case a naive expansion gets wrong by skipping single hits.
  const both = await run("repeat x4 + skip 2", { repeat: 4, skip: 2 });
  check("passes [7, 3, 7, 3]", JSON.stringify(both.perPass) === "[7,3,7,3]");

  console.log(
    ok
      ? "\nOK — les effets de pad s'entendent"
      : "\nECHEC — le rendu ne suit pas les effets",
  );
  process.exit(ok ? 0 : 1);
}

void main();
