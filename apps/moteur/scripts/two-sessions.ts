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
  const lanes = new EngineClient(URL, SESSIONS.lanes);
  const platines = new EngineClient(URL, SESSIONS.platines);
  const onLanes = watch(lanes);
  const onPlatines = watch(platines);
  lanes.connect();
  platines.connect();

  await wait(500);
  lanes.sendProject(doc("depuis-lanes", 45));
  platines.sendProject(doc("depuis-platines", 64));
  await wait(3000);

  // ONE of them plays. Before sessions the second project tore the first down; before the
  // client half, the silent one saw the playing one's state frames as its own.
  lanes.transport("play");
  await wait(4000);

  console.log("lanes    :", onLanes);
  console.log("platines :", onPlatines);

  const problems: string[] = [];
  if (!onLanes.playing)
    problems.push("lanes n'a jamais vu son transport partir");
  if (onLanes.maxPlayhead < 1)
    problems.push("la tete de lecture de lanes n'a pas avance");
  if (onPlatines.frames === 0)
    problems.push(
      "platines ne recoit aucune trame d'etat (session filtree a tort)",
    );
  if (onPlatines.playing)
    problems.push("platines a vu le transport de lanes — les sessions fuient");
  if (onPlatines.maxPlayhead > 0.5)
    problems.push("la tete de lecture de lanes a fuit vers platines");

  lanes.close();
  platines.close();
  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — chaque client ne voit que sa propre session");
  process.exit(0);
}

void main();
