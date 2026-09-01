// callback-cost.ts — what the AUDIO CALLBACK costs, at rest and under a driven scratch.
//   npx tsx engine/st0-engine/scripts/callback-cost.ts [setsPerSecond] [seconds]
// Needs the engine's `audio-cost` verb and a session with PLATTERS loaded: it drives Rate on
// deck A's four, the way a hand would, and reads Tracktion's own per-block measurement either
// side. The max is the column that matters — the block that came closest to the deadline.
// It makes NOISE, deliberately: that is the load being measured. Numbers in docs/constat.md.
//
// TypeScript rather than .mjs since the platters became NODES: their ids are `<lane>:<module>` and
// the names belong to `@studio/song-schema/stems`, which the desk and the scaffold both read. It
// used to spell `stemDrumsA:platter` by hand, and when the rename landed it went on measuring —
// driving four addresses the engine did not have, reporting a scratch that never happened.
// See ../../../docs/platter-node-plan.md.

import { STEMS, stemLane, stemPlatter } from "@studio/song-schema/stems";
import WebSocket from "ws";

const session = "st0:fred_parapluie_org";
const HZ = Number(process.argv[2] ?? 1000);
const SECS = Number(process.argv[3] ?? 5);

/** Deck A's four stem platters, as the project DECLARES them — the worst case, four stretchers. */
const IDS = STEMS.map((s) => `${stemLane("deckA", s)}:${stemPlatter("deckA", s)}`);

interface Cost {
  runs: number;
  meanMs: number;
  maxMs: number;
  deadlineMs: number;
}

const ws = new WebSocket("ws://127.0.0.1:8765");
let waiting: ((c: Cost) => void) | null = null;
ws.on("error", (e: Error) => {
  console.log("ERREUR:", e.message);
  process.exit(1);
});
ws.on("message", (buf: Buffer) => {
  let m: Cost & { type?: string };
  try {
    m = JSON.parse(buf.toString());
  } catch {
    return;
  }
  if (m.type !== "audio-cost" || !waiting) return;
  const d = waiting;
  waiting = null;
  d(m);
});

const ask = (reset: boolean) =>
  new Promise<Cost>((r) => {
    waiting = r;
    ws.send(JSON.stringify({ type: "audio-cost", reset }));
  });

const show = (t: string, c: Cost) =>
  console.log(
    `${t} : ${c.runs} blocs, moyen ${c.meanMs.toFixed(3)} ms, MAX ${c.maxMs.toFixed(3)} ms` +
      ` (${((c.maxMs / c.deadlineMs) * 100).toFixed(1)} % de ${c.deadlineMs.toFixed(2)} ms)`,
  );

ws.on("open", async () => {
  console.log(`plateaux pilotés : ${IDS.join(", ")}\n`);
  await ask(true);
  await new Promise((r) => setTimeout(r, SECS * 1000));
  const idle = await ask(true);
  show("sans geste ", idle);

  let n = 0;
  const t0 = Date.now();
  const timer = setInterval(
    () => {
      // A speed that comes and goes like a hand on the record, between -2 and +2.
      const rate = 2 * Math.sin((Date.now() - t0) / 120);
      for (const id of IDS)
        ws.send(
          JSON.stringify({
            type: "set-plugin-param",
            session,
            id,
            name: "Rate",
            value: rate,
          }),
        );
      n += IDS.length;
    },
    Math.max(1, Math.round(1000 / HZ)),
  );
  await new Promise((r) => setTimeout(r, SECS * 1000));
  clearInterval(timer);
  const busy = await ask(false);
  show("EN SCRATCH", busy);
  console.log(
    `   ${n} reglages envoyes en ${SECS}s, soit ${Math.round(n / SECS)}/s`,
  );

  // The check this script lacked, and which let a rename break it in silence: `set-plugin-param`
  // to an address the engine has not got is dropped without a word, so four thousand of them a
  // second read exactly like a deck that costs nothing. If the cost did not MOVE, say so — the
  // measurement is meaningless rather than flattering.
  //
  // On the MEAN and not the max: the max is one block and jitters by a microsecond either way, so
  // comparing it called 0.010 against 0.009 a real difference and stayed quiet. Ten percent of the
  // mean is the smallest change worth calling a scratch.
  if (busy.meanMs < idle.meanMs * 1.1) {
    console.log(
      "\n⚠ le scratch n'a RIEN coûté de plus qu'au repos. Deux causes, et une seule est bonne :",
    );
    console.log(
      "  - aucun disque séparé sur la platine A, donc les quatre plateaux ne jouent rien ;",
    );
    console.log(
      "  - ou ces identifiants ne sont pas ceux de la session — un paramètre envoyé à une adresse",
    );
    console.log(
      "    inconnue est jeté sans erreur, et la mesure ressemble alors à une bonne nouvelle.",
    );
    console.log(
      `  Vérifiez avec : npx tsx engine/st0-engine/scripts/list-sessions.ts 8765 --peek`,
    );
  }

  for (const id of IDS)
    ws.send(
      JSON.stringify({
        type: "set-plugin-param",
        session,
        id,
        name: "Rate",
        value: 0,
      }),
    );
  setTimeout(() => process.exit(0), 300);
});
