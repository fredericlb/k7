// list-sessions.ts — the supervisor's view of a running engine, through the SAME EngineQueries
// the tray uses, so this proves the whole chain up to HostSnapshot rather than just the wire.
// Creates two sessions, lists them, drops one, lists again.
//   npx tsx apps/moteur/scripts/list-sessions.ts   (engine on :8833)

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

async function main() {
  const lanes = new EngineClient("ws://127.0.0.1:8833", "lanes");
  const platines = new EngineClient("ws://127.0.0.1:8833", "platines");
  lanes.connect();
  platines.connect();
  await wait(500);
  lanes.sendProject(doc("ma-chanson"));
  platines.sendProject(doc("le-set"));
  await wait(2500);
  lanes.transport("play");
  await wait(1500);

  // The supervisor's own client, on the DEFAULT session: it drives nothing and asks about
  // everyone. That is the whole reason list-sessions carries no session field.
  const q = new EngineQueries(8833);
  const before = await q.listSessions();
  console.log("vues par le superviseur :", before);

  await q.dropSession("platines");
  await wait(500);
  const after = await q.listSessions();
  console.log("apres drop de platines  :", after);

  const problems: string[] = [];
  const ids = (list: typeof before) => (list ?? []).map((s) => s.id).sort();
  if (ids(before).join() !== "lanes,platines")
    problems.push(`sessions attendues lanes+platines, vu ${ids(before)}`);
  const l = before?.find((s) => s.id === "lanes");
  if (!l?.playing) problems.push("lanes ne joue pas");
  if (!l?.loaded || l.project !== "ma-chanson" || l.tracks !== 1)
    problems.push(`le projet de lanes est mal rapporte : ${JSON.stringify(l)}`);
  if (before?.find((s) => s.id === "platines")?.playing)
    problems.push("platines joue alors qu'on ne le lui a pas demande");
  if (ids(after).join() !== "lanes")
    problems.push(`drop sans effet : reste ${ids(after)}`);

  q.close();
  lanes.close();
  platines.close();
  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — le superviseur voit les sessions et peut en larguer une");
  process.exit(0);
}

void main();
