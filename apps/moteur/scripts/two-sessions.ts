// two-sessions.ts — the proof that two services no longer clobber each other on one engine,
// driven through the REAL clients rather than hand-rolled JSON, so it also proves the client
// half. Two projects, two sessions: both apply, only one plays, and the idle one must not see
// the other's transport. Usage: npx tsx apps/moteur/scripts/two-sessions.ts   (engine on :8833)

import { EngineClient } from "@studio/engine-client/engineClient";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { SESSIONS } from "@studio/engine-protocol/sessions";

const URL = "ws://127.0.0.1:8833";

// A minute of one held note through a 4osc — enough signal to be unambiguous, cheap to build.
const doc = (name: string, key: number): ProjectDoc =>
  ({
    name,
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
        name,
        clips: [
          {
            id: "c1",
            type: "midi",
            name: "t",
            start: 0,
            length: 600,
            notes: [{ time: 0, duration: 600, key, vel: 0.8, channel: 1 }],
          },
        ],
        plugins: [
          { id: "t1:synth", type: "4osc", name: "synth", role: "instrument" },
        ],
      },
    ],
  }) as unknown as ProjectDoc;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Seen {
  playing: boolean;
  maxPlayhead: number;
  frames: number;
}

function watch(c: EngineClient): Seen {
  const seen: Seen = { playing: false, maxPlayhead: 0, frames: 0 };
  c.on("state", (s: { playing: boolean; playhead: number }) => {
    seen.frames++;
    if (s.playing) seen.playing = true;
    seen.maxPlayhead = Math.max(seen.maxPlayhead, s.playhead);
  });
  return seen;
}

// Wrapped rather than top-level await: apps/moteur declares no `"type": "module"`, so tsx
// transforms this to CJS and a bare await is a syntax error there.
async function main() {
  const pistes = new EngineClient(URL, SESSIONS.pistes);
  const m9 = new EngineClient(URL, SESSIONS.m9);
  const onPistes = watch(pistes);
  const onM9 = watch(m9);
  pistes.connect();
  m9.connect();

  await wait(500);
  pistes.sendProject(doc("depuis-pistes", 45));
  m9.sendProject(doc("depuis-m9", 64));
  await wait(3000);

  // ONE of them plays. Before sessions the second project tore the first down; before the
  // client half, the silent one saw the playing one's state frames as its own.
  pistes.transport("play");
  await wait(4000);

  console.log("pistes    :", onPistes);
  console.log("m9        :", onM9);

  const problems: string[] = [];
  if (!onPistes.playing)
    problems.push("pistes n'a jamais vu son transport partir");
  if (onPistes.maxPlayhead < 1)
    problems.push("la tete de lecture de pistes n'a pas avance");
  if (onM9.frames === 0)
    problems.push(
      "m9 ne recoit aucune trame d'etat (session filtree a tort)",
    );
  if (onM9.playing)
    problems.push("m9 a vu le transport de pistes — les sessions fuient");
  if (onM9.maxPlayhead > 0.5)
    problems.push("la tete de lecture de pistes a fuit vers m9");

  pistes.close();
  m9.close();
  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — chaque client ne voit que sa propre session");
  process.exit(0);
}

void main();
