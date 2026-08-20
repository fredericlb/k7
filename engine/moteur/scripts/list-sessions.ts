// list-sessions.ts — the supervisor's view of a running engine, through the SAME EngineQueries
// the tray uses, so this proves the whole chain up to HostSnapshot rather than just the wire.
// Creates two sessions, lists them, drops one, lists again.
//   npx tsx engine/moteur/scripts/list-sessions.ts            (a throwaway engine on :8833)
//   npx tsx engine/moteur/scripts/list-sessions.ts 8765 --peek  (LOOK at a live one, change nothing)

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
  const st0 = new EngineClient(`ws://127.0.0.1:${PORT}`, "st0");
  const m9 = new EngineClient(`ws://127.0.0.1:${PORT}`, "m9");
  st0.connect();
  m9.connect();
  await wait(500);
  st0.sendProject(doc("ma-chanson"));
  m9.sendProject(doc("le-set"));
  await wait(2500);
  st0.transport("play");
  await wait(1500);

  // The supervisor's own client, on the DEFAULT session: it drives nothing and asks about
  // everyone. That is the whole reason list-sessions carries no session field.
  const q = new EngineQueries(PORT);

  // Ask everything the tray polls BEFORE listing, because that is the regression: reading used
  // to create, so these very queries conjured a "" session which then appeared in the tray's own
  // Sessions submenu — reported by the process that had just invented it.
  const plugins = await q.listEditPlugins();
  await q.pluginCount();
  await q.listAudioDevices();

  const before = await q.listSessions();
  console.log("vues par le superviseur :", before);
  console.log("edit-plugins            :", plugins);

  await q.dropSession("m9");
  await wait(500);
  const after = await q.listSessions();
  console.log("apres drop de m9        :", after);

  const problems: string[] = [];
  const ids = (list: typeof before) => (list ?? []).map((s) => s.id).sort();
  if (ids(before).join() !== "st0,m9")
    problems.push(`sessions attendues st0+m9, vu ${ids(before)}`);
  // EXACTEMENT deux : une session "" ici veut dire que les requetes du superviseur en creent une.
  if ((before ?? []).some((s) => s.id === ""))
    problems.push(
      "une session '' existe — une LECTURE a cree une session (cf. engine/moteur/docs/sessions.md)",
    );
  // edit-plugins est global au moteur : il repond pour les DEUX sessions, chacune nommee.
  const sessionsVues = new Set((plugins ?? []).map((p) => p.session));
  if (!sessionsVues.has("st0") || !sessionsVues.has("m9"))
    problems.push(
      `edit-plugins devrait couvrir st0 et m9, vu ${JSON.stringify([...sessionsVues])}`,
    );
  const l = before?.find((s) => s.id === "st0");
  if (!l?.playing) problems.push("st0 ne joue pas");
  if (!l?.loaded || l.project !== "ma-chanson" || l.tracks !== 1)
    problems.push(`le projet de st0 est mal rapporte : ${JSON.stringify(l)}`);
  if (before?.find((s) => s.id === "m9")?.playing)
    problems.push("m9 joue alors qu'on ne le lui a pas demande");
  if (ids(after).join() !== "st0")
    problems.push(`drop sans effet : reste ${ids(after)}`);

  q.close();
  st0.close();
  m9.close();
  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — le superviseur voit les sessions et peut en larguer une");
  process.exit(0);
}

void main();
