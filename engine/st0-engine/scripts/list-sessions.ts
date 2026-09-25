// list-sessions.ts — the supervisor's view of a running engine: a client on the DEFAULT session,
// driving nothing, asking what the native supervisor asks (engine/st0-supervisor/src/EngineQueries.cpp).
// Creates two sessions, lists them, drops one, lists again.
//   npx tsx engine/st0-engine/scripts/list-sessions.ts            (a throwaway engine on :8833)
//   npx tsx engine/st0-engine/scripts/list-sessions.ts 8765 --peek  (LOOK at a live one, change nothing)

import { once } from "node:events";
import { EngineClient } from "@studio/engine-client/engineClient";
import {
  type EditPluginInfo,
  EngineControl,
  type SessionInfo,
} from "@studio/engine-client/engineControl";
import type { ProjectDoc } from "@studio/engine-protocol/project";

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

/** The supervisor's own client: the DEFAULT session, one question at a time, each with its deadline. */
class Supervisor {
  private readonly c: EngineControl;
  constructor(port: number) {
    this.c = new EngineControl(`ws://127.0.0.1:${port}`);
    this.c.on("wserror", () => {});
  }
  async open(): Promise<void> {
    this.c.connect();
    await once(this.c, "open", { signal: AbortSignal.timeout(4000) });
  }
  private async ask<T>(event: string, send: () => void): Promise<T> {
    const reply = once(this.c, event, { signal: AbortSignal.timeout(6000) });
    send();
    return (await reply)[0] as T;
  }
  listSessions = () =>
    this.ask<SessionInfo[]>("sessions", () => this.c.listSessions());
  listEditPlugins = () =>
    this.ask<EditPluginInfo[]>("editPlugins", () => this.c.listEditPlugins());
  listPlugins = () => this.ask<unknown[]>("plugins", () => this.c.listPlugins());
  listAudioDevices = () =>
    this.ask<unknown[]>("audioDevices", () => this.c.listAudioDevices());
  dropSession = (s: string) => this.c.dropSession(s);
  close = () => this.c.close();
}

const PORT = Number(process.argv[2] || 8833);
// Read-only against a REAL engine, or it is a way to lose a song (../docs/sessions.md).
const PEEK = process.argv.includes("--peek");

async function main() {
  if (PEEK) {
    const q = new Supervisor(PORT);
    await q.open();
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

  // The supervisor's own client, on the DEFAULT session, driving nothing (../docs/sessions.md).
  const q = new Supervisor(PORT);
  await q.open();

  // Ask everything the tray polls BEFORE listing: a read must never CREATE (../docs/sessions.md).
  const plugins = await q.listEditPlugins();
  await q.listPlugins();
  await q.listAudioDevices();

  const before = await q.listSessions();
  console.log("vues par le superviseur :", before);
  console.log("edit-plugins            :", plugins);

  q.dropSession("m9");
  await wait(500);
  const after = await q.listSessions();
  console.log("apres drop de m9        :", after);

  const problems: string[] = [];
  const ids = (list: typeof before) => (list ?? []).map((s) => s.id).sort();
  if (ids(before).join() !== "st0,m9")
    problems.push(`sessions attendues st0+m9, vu ${ids(before)}`);
  // EXACTLY two: a "" session here means the supervisor's requests are creating one.
  if ((before ?? []).some((s) => s.id === ""))
    problems.push(
      "une session '' existe — une LECTURE a cree une session (cf. engine/st0-engine/docs/sessions.md)",
    );
  // edit-plugins is engine-wide: it answers for BOTH sessions, each one named.
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
