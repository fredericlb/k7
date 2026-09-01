// track-delta.ts — the proof that `tracks` amends the document a session already holds, rather
// than replacing it or growing it. Three observable answers: refused with no project, accepted
// for a track the session has, and WARNED for one it does not.
//
// Its own session id, so running it disturbs nothing that is playing.
// Usage: npx tsx engine/st0-engine/scripts/track-delta.ts [ws://host:port]   (default :8833)

import type { ProjectDoc } from "@studio/engine-protocol/project";
import WebSocket from "ws";

const URL = process.argv[2] ?? process.env.STUDIO_ENGINE_WS ?? "ws://127.0.0.1:8833";
const SESSION = "delta-probe";

const track = (id: string, key: number, name = id) => ({
  id,
  name,
  role: "regular",
  contentType: "notes",
  clips: [
    {
      id: `${id}-c1`,
      type: "midi",
      name: "",
      start: 0,
      length: 8,
      notes: [{ time: 0, duration: 8, key, vel: 0.8, channel: 1 }],
    },
  ],
  plugins: [{ id: `${id}:synth`, type: "4osc", name: "synth", role: "instrument" }],
});

const doc = (): ProjectDoc =>
  ({
    name: "delta-probe",
    tempo: 120,
    sampleRate: 48000,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    recordDir: "",
    settings: { metronome: false, countIn: 0 },
    groups: [],
    tracks: [track("t1", 45), track("t2", 52)],
  }) as unknown as ProjectDoc;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ws = new WebSocket(URL);
  const errors: string[] = [];
  const warnings: string[] = [];
  ws.on("error", (e) => {
    console.error(`ECHEC : ${(e as Error).message}`);
    process.exit(1);
  });
  ws.on("message", (d) => {
    let m: { type?: string; session?: string; message?: string };
    try {
      m = JSON.parse(d.toString());
    } catch {
      return;
    }
    if (m.session !== SESSION) return;
    if (m.type === "error") errors.push(String(m.message));
    if (m.type === "engine-warning") warnings.push(String(m.message));
  });
  const send = (o: object) => ws.send(JSON.stringify({ session: SESSION, ...o }));
  await new Promise((r) => ws.once("open", r));

  // 1. A delta with nothing loaded is refused, and says so.
  send({ type: "tracks", tracks: [track("t1", 45)] });
  await wait(800);
  const refusedEmpty = errors.some((e) => /holds no project/.test(e));

  // 2. …then the document, and a delta that moves one of its tracks: accepted in silence.
  send({ type: "project", doc: doc() });
  await wait(2500);
  errors.length = 0;
  warnings.length = 0;
  send({ type: "tracks", tracks: [track("t1", 60)] });
  await wait(1200);
  const quiet = errors.length === 0 && warnings.length === 0;

  // 3. …and one naming a track this project does not hold is warned about, not appended.
  send({ type: "tracks", tracks: [track("nope", 40)] });
  await wait(1200);
  const warnedUnknown = warnings.some((w) => /does not hold/.test(w));

  send({ type: "drop-session", session: SESSION });
  await wait(300);
  ws.close();

  const problems: string[] = [];
  if (!refusedEmpty)
    problems.push("un delta sans projet chargé n'a pas été refusé");
  if (!quiet)
    problems.push(
      `un delta sur une piste connue a produit du bruit : ${[...errors, ...warnings].join(" | ")}`,
    );
  if (!warnedUnknown)
    problems.push("un delta sur une piste inconnue n'a pas été signalé");

  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — le delta amende le document tenu, et refuse le reste");
  process.exit(0);
}

void main();
