// two-sessions.ts — the proof that two services no longer clobber each other on one engine,
// driven through the REAL clients rather than hand-rolled JSON, so it also proves the client
// half. Two projects, two sessions: both apply, only one plays, and the idle one must not see
// the other's transport. Usage: npx tsx engine/moteur/scripts/two-sessions.ts   (engine on :8833)

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
  /** Whether this client ever saw record-enable ON — it is per session, not per process. */
  recordEnabled: boolean;
  /** Replies about ONE project. Unstamped, every client on the engine used to read them all. */
  applied: number;
  flushed: number;
}

function watch(c: EngineClient): Seen {
  const seen: Seen = {
    playing: false,
    maxPlayhead: 0,
    frames: 0,
    recordEnabled: false,
    applied: 0,
    flushed: 0,
  };
  c.on(
    "state",
    (s: { playing: boolean; playhead: number; recordEnabled?: boolean }) => {
      seen.frames++;
      if (s.playing) seen.playing = true;
      if (s.recordEnabled) seen.recordEnabled = true;
      seen.maxPlayhead = Math.max(seen.maxPlayhead, s.playhead);
    },
  );
  c.on("applied", () => {
    seen.applied++;
  });
  c.on("flushed", () => {
    seen.flushed++;
  });
  return seen;
}

// Wrapped rather than top-level await: engine/moteur declares no `"type": "module"`, so tsx
// transforms this to CJS and a bare await is a syntax error there.
async function main() {
  const l8 = new EngineClient(URL, SESSIONS.l8);
  const m9 = new EngineClient(URL, SESSIONS.m9);
  const onL8 = watch(l8);
  const onM9 = watch(m9);
  l8.connect();
  m9.connect();

  await wait(500);
  l8.sendProject(doc("depuis-l8", 45));
  m9.sendProject(doc("depuis-m9", 64));
  await wait(3000);

  // Record-enable is SESSION state. It was a process-global for a while, so arming l8 lit m9's
  // record light and made rolling either one record into both.
  l8.setRecordEnabled(true);
  await wait(1000);

  // ONE of them plays. Before sessions the second project tore the first down; before the
  // client half, the silent one saw the playing one's state frames as its own.
  l8.transport("play");
  await wait(4000);

  // A flush is about ONE project. Unstamped, m9 read l8's `flushed` as its own.
  l8.flush();
  await wait(1000);

  console.log("l8    :", onL8);
  console.log("m9        :", onM9);

  const problems: string[] = [];
  if (!onL8.playing)
    problems.push("l8 n'a jamais vu son transport partir");
  if (onL8.maxPlayhead < 1)
    problems.push("la tete de lecture de l8 n'a pas avance");
  if (onM9.frames === 0)
    problems.push(
      "m9 ne recoit aucune trame d'etat (session filtree a tort)",
    );
  if (onM9.playing)
    problems.push("m9 a vu le transport de l8 — les sessions fuient");
  if (onM9.maxPlayhead > 0.5)
    problems.push("la tete de lecture de l8 a fuit vers m9");
  if (!onL8.recordEnabled)
    problems.push("l8 n'a jamais vu son propre record-enable");
  if (onM9.recordEnabled)
    problems.push("m9 a vu le record-enable de l8 — le drapeau est global");
  if (onL8.applied !== 1)
    problems.push(`l8 attend 1 'applied', en a vu ${onL8.applied}`);
  if (onM9.applied !== 1)
    problems.push(
      `m9 attend 1 'applied' (le sien), en a vu ${onM9.applied} — reponses non estampillees`,
    );
  if (onL8.flushed !== 1)
    problems.push(`l8 attend 1 'flushed', en a vu ${onL8.flushed}`);
  if (onM9.flushed !== 0)
    problems.push(
      `m9 a recu le 'flushed' de l8 (${onM9.flushed}) — reponses non estampillees`,
    );

  l8.close();
  m9.close();
  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — chaque client ne voit que sa propre session");
  process.exit(0);
}

void main();
