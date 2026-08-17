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

/**
 * A raw socket, counting `state` frames BY the session they name.
 *
 * The clients above cannot show this: `forSession` drops another project's frames before the
 * event fires, so a client sees the same thing whether the engine addressed its frames or shouted
 * them at everyone. What the wire costs — a decode and a discard per frame, per tab, per session
 * on the machine — is only visible here.
 *
 * `hello` is what declares the session, exactly as the browser client does. A socket that sends
 * nothing declares nothing, which is the probe case the last count below covers.
 */
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

// Wrapped rather than top-level await: engine/moteur declares no `"type": "module"`, so tsx
// transforms this to CJS and a bare await is a syntax error there.
async function main() {
  const l8 = new EngineClient(URL, SESSIONS.l8);
  const st0 = new EngineClient(URL, SESSIONS.st0);
  const onL8 = watch(l8);
  const onSt0 = watch(st0);
  const onWire = wire(SESSIONS.st0); // a surface on st0, watching the wire itself
  const onProbe = wire(); // the tray: opens, says nothing, is gone
  l8.connect();
  st0.connect();

  await wait(500);
  l8.sendProject(doc("depuis-l8", 45));
  st0.sendProject(doc("depuis-st0", 64));
  await wait(3000);

  // Record-enable is SESSION state. It was a process-global for a while, so arming l8 lit st0's
  // record light and made rolling either one record into both.
  l8.setRecordEnabled(true);
  await wait(1000);

  // ONE of them plays. Before sessions the second project tore the first down; before the
  // client half, the silent one saw the playing one's state frames as its own.
  l8.transport("play");
  await wait(4000);

  // A flush is about ONE project. Unstamped, st0 read l8's `flushed` as its own.
  l8.flush();
  await wait(1000);

  console.log("l8    :", onL8);
  console.log("st0       :", onSt0);
  console.log("sur le fil (st0) :", onWire);
  console.log("sur le fil (sonde):", onProbe);

  const problems: string[] = [];
  // What was SENT, not what was kept. A state frame is a per-track level array plus whatever
  // waveform envelopes are subscribed, at 20 Hz: shouted at every socket, each tab decoded every
  // other project's meters to throw them away, and one session playing kept every other
  // session's tabs awake past their own idle divider.
  if (!onWire[SESSIONS.st0])
    problems.push("le socket st0 ne recoit aucune trame de sa propre session");
  for (const sid of Object.keys(onWire))
    if (sid !== SESSIONS.st0)
      problems.push(
        `le socket st0 a recu ${onWire[sid]} trame(s) de '${sid}' — les trames d'etat sont diffusees`,
      );
  for (const sid of Object.keys(onProbe))
    problems.push(
      `une sonde muette a recu ${onProbe[sid]} trame(s) de '${sid}' — elle n'a rien demande`,
    );
  if (!onL8.playing)
    problems.push("l8 n'a jamais vu son transport partir");
  if (onL8.maxPlayhead < 1)
    problems.push("la tete de lecture de l8 n'a pas avance");
  if (onSt0.frames === 0)
    problems.push(
      "st0 ne recoit aucune trame d'etat (session filtree a tort)",
    );
  if (onSt0.playing)
    problems.push("st0 a vu le transport de l8 — les sessions fuient");
  if (onSt0.maxPlayhead > 0.5)
    problems.push("la tete de lecture de l8 a fuit vers st0");
  if (!onL8.recordEnabled)
    problems.push("l8 n'a jamais vu son propre record-enable");
  if (onSt0.recordEnabled)
    problems.push("st0 a vu le record-enable de l8 — le drapeau est global");
  if (onL8.applied !== 1)
    problems.push(`l8 attend 1 'applied', en a vu ${onL8.applied}`);
  if (onSt0.applied !== 1)
    problems.push(
      `st0 attend 1 'applied' (le sien), en a vu ${onSt0.applied} — reponses non estampillees`,
    );
  if (onL8.flushed !== 1)
    problems.push(`l8 attend 1 'flushed', en a vu ${onL8.flushed}`);
  if (onSt0.flushed !== 0)
    problems.push(
      `st0 a recu le 'flushed' de l8 (${onSt0.flushed}) — reponses non estampillees`,
    );

  l8.close();
  st0.close();
  if (problems.length) {
    for (const p of problems) console.error("ECHEC :", p);
    process.exit(1);
  }
  console.log("OK — chaque client ne voit que sa propre session");
  process.exit(0);
}

void main();
