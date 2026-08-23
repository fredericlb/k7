// two-sessions.ts — the proof that two services no longer clobber each other on one engine,
// driven through the REAL clients rather than hand-rolled JSON, so it also proves the client
// half. Two projects, two sessions: both apply, only one plays, and the idle one must not see
// the other's transport. Plus two RAW sockets, which is the only way to see what was actually
// SENT rather than what a client kept — see `wire` below.
// Usage: npx tsx engine/moteur/scripts/two-sessions.ts [ws://host:port]   (default :8833; the
// dev session's engine is on :8765)

import { EngineClient } from "@studio/engine-client/engineClient";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { SESSIONS } from "@studio/engine-protocol/sessions";
import WebSocket from "ws";

const URL = process.argv[2] ?? process.env.STUDIO_ENGINE_WS ?? "ws://127.0.0.1:8833";

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

/** A raw socket, counting `state` frames BY the session they name — see ../docs/sessions.md. */
function wire(session?: string): Record<string, number> {
  const seen: Record<string, number> = {};
  const ws = new WebSocket(URL);
  ws.on("open", () => {
    if (session !== undefined)
      ws.send(JSON.stringify({ session, type: "hello" }));
  });
  ws.on("error", () => {});
  ws.on("message", (d) => {
    let m: { type?: string; session?: string };
    try {
      m = JSON.parse(d.toString());
    } catch {
      return;
    }
    if (m.type !== "state") return;
    const k = m.session ?? "(none)";
    seen[k] = (seen[k] ?? 0) + 1;
  });
  return seen;
}

// Wrapped rather than top-level await: tsx transforms this to CJS (../docs/sessions.md).
async function main() {
  const st0 = new EngineClient(URL, SESSIONS.st0);
  const pl8 = new EngineClient(URL, SESSIONS.pl8);
  const onSt0 = watch(st0);
  const onPl8 = watch(pl8);
  const onWire = wire(SESSIONS.pl8); // a surface on pl8, watching the wire itself
  const onProbe = wire(); // the tray: opens, says nothing, is gone
  st0.connect();
  pl8.connect();

  await wait(500);
  st0.sendProject(doc("depuis-st0", 45));
  pl8.sendProject(doc("depuis-pl8", 64));
  await wait(3000);

  // Record-enable is SESSION state, and was a process-global for a while (../docs/sessions.md).
  st0.setRecordEnabled(true);
  await wait(1000);

  // ONE of them plays, which was true of neither half once (../docs/sessions.md).
  st0.transport("play");
  await wait(4000);

  // A flush is about ONE project. Unstamped, pl8 read st0's `flushed` as its own.
  st0.flush();
  await wait(1000);

  console.log("st0    :", onSt0);
  console.log("pl8       :", onPl8);
  console.log("sur le fil (pl8) :", onWire);
  console.log("sur le fil (sonde):", onProbe);

  const problems: string[] = [];
  // What was SENT, not what was kept — the whole cost is on the wire (../docs/sessions.md).
  if (!onWire[SESSIONS.pl8])
    problems.push("le socket pl8 ne recoit aucune trame de sa propre session");
  for (const sid of Object.keys(onWire))
    if (sid !== SESSIONS.pl8)
      problems.push(
        `le socket pl8 a recu ${onWire[sid]} trame(s) de '${sid}' — les trames d'etat sont diffusees`,
      );
  for (const sid of Object.keys(onProbe))
    problems.push(
      `une sonde muette a recu ${onProbe[sid]} trame(s) de '${sid}' — elle n'a rien demande`,
    );
  if (!onSt0.playing)
    problems.push("st0 n'a jamais vu son transport partir");
  if (onSt0.maxPlayhead < 1)
    problems.push("la tete de lecture de st0 n'a pas avance");
  if (onPl8.frames === 0)
    problems.push(
      "pl8 ne recoit aucune trame d'etat (session filtree a tort)",
    );
  if (onPl8.playing)
    problems.push("pl8 a vu le transport de st0 — les sessions fuient");
  if (onPl8.maxPlayhead > 0.5)
    problems.push("la tete de lecture de st0 a fuit vers pl8");
  if (!onSt0.recordEnabled)
    problems.push("st0 n'a jamais vu son propre record-enable");
  if (onPl8.recordEnabled)
    problems.push("pl8 a vu le record-enable de st0 — le drapeau est global");
  if (onSt0.applied !== 1)
    problems.push(`st0 attend 1 'applied', en a vu ${onSt0.applied}`);
  if (onPl8.applied !== 1)
    problems.push(
      `pl8 attend 1 'applied' (le sien), en a vu ${onPl8.applied} — reponses non estampillees`,
    );
  if (onSt0.flushed !== 1)
    problems.push(`st0 attend 1 'flushed', en a vu ${onSt0.flushed}`);
  if (onPl8.flushed !== 0)
    problems.push(
      `pl8 a recu le 'flushed' de st0 (${onPl8.flushed}) — reponses non estampillees`,
    );

  st0.close();
  pl8.close();
  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — chaque client ne voit que sa propre session");
  process.exit(0);
}

void main();
