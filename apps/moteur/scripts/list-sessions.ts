// list-sessions.ts — the supervisor's view of a running engine, through the SAME EngineQueries
// the tray uses, so this proves the whole chain up to HostSnapshot rather than just the wire.
// Creates two sessions, lists them, drops one, lists again.
//   npx tsx apps/moteur/scripts/list-sessions.ts            (a throwaway engine on :8833)
//   npx tsx apps/moteur/scripts/list-sessions.ts 8765 --peek  (LOOK at a live one, change nothing)

import { EngineClient } from "@studio/engine-client/engineClient";
import type { ProjectDoc } from "@studio/engine-protocol/project";
// By RELATIVE path, not a subpath import: engineQueries is internal to @studio/engine-host
// and its `exports` says so. Widening a package's public surface for a probe would be the
// wrong trade — the probe is the thing that should bend.
import { EngineQueries } from "../../../packages/engine-host/src/engineQueries.ts";

const doc = (name: string): ProjectDoc =>
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
        name: "piste",
        clips: [
          {
            id: "c1",
            type: "midi",
            name: "t",
            start: 0,
            length: 600,
            notes: [{ time: 0, duration: 600, key: 45, vel: 0.8, channel: 1 }],
          },
        ],
        plugins: [
          { id: "t1:synth", type: "4osc", name: "synth", role: "instrument" },
        ],
      },
    ],
  }) as unknown as ProjectDoc;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PORT = Number(process.argv[2] || 8833);
// Read-only against a REAL engine: it must not send projects or drop anyone's session, which
// is the difference between a diagnostic and a way to lose the song someone is working on.
const PEEK = process.argv.includes("--peek");

async function main() {
  if (PEEK) {
    const q = new EngineQueries(PORT);
    console.log("sessions sur :" + PORT, await q.listSessions());
    q.close();
    return process.exit(0);
  }
  const pistes = new EngineClient(`ws://127.0.0.1:${PORT}`, "pistes");
  const platines = new EngineClient(`ws://127.0.0.1:${PORT}`, "platines");
  pistes.connect();
  platines.connect();
  await wait(500);
  pistes.sendProject(doc("ma-chanson"));
  platines.sendProject(doc("le-set"));
  await wait(2500);
  pistes.transport("play");
  await wait(1500);

  // The supervisor's own client, on the DEFAULT session: it drives nothing and asks about
  // everyone. That is the whole reason list-sessions carries no session field.
  const q = new EngineQueries(PORT);
  const before = await q.listSessions();
  console.log("vues par le superviseur :", before);

  await q.dropSession("platines");
  await wait(500);
  const after = await q.listSessions();
  console.log("apres drop de platines  :", after);

  const problems: string[] = [];
  const ids = (list: typeof before) => (list ?? []).map((s) => s.id).sort();
  if (ids(before).join() !== "pistes,platines")
    problems.push(`sessions attendues pistes+platines, vu ${ids(before)}`);
  const l = before?.find((s) => s.id === "pistes");
  if (!l?.playing) problems.push("pistes ne joue pas");
  if (!l?.loaded || l.project !== "ma-chanson" || l.tracks !== 1)
    problems.push(`le projet de pistes est mal rapporte : ${JSON.stringify(l)}`);
  if (before?.find((s) => s.id === "platines")?.playing)
    problems.push("platines joue alors qu'on ne le lui a pas demande");
  if (ids(after).join() !== "pistes")
    problems.push(`drop sans effet : reste ${ids(after)}`);

  q.close();
  pistes.close();
  platines.close();
  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — le superviseur voit les sessions et peut en larguer une");
  process.exit(0);
}

void main();
