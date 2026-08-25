// put-on.ts — ce que coûte POSER un disque sur une platine qui en tient déjà un.
//
//   npx tsx packages/ui-turntables/scripts/put-on.ts [ws://127.0.0.1:8765] [--minutes=2] [--runs=6]
//
// C'est le geste le plus fréquent du pupitre, et depuis que les stems jouent sur des plateaux il en
// charge quatre au lieu d'un. Le chiffre qui avait servi à décider — 441 ms contre 267 — était un
// apply À FROID sur un moteur vide, c'est-à-dire le chargement de la page, une fois. Ici la platine
// tient déjà un disque, ce qui est la vraie question.
//
// Il envoie le document que `withDecks` produit, et chronomètre jusqu'à la réponse `applied`.
//
// `--hold=30 [--key]` répond à l'autre question : ce que HUIT plateaux coûtent en tournant, avec ou
// sans étireur. Il charge deux platines séparées, les lance et tient ; le CPU se lit à côté :
//
//   Get-Process studio-moteur | Select-Object CPU   (deux fois, et on divise l'écart par le temps)

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { STEMS, stemLane } from "@studio/song-schema/stems";
import WebSocket from "ws";
import {
  DECKS,
  type DeckLoads,
  deckDoc,
  NO_LOADS,
  withDecks,
} from "../src/deck";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const arg = (name: string, fallback: number) =>
  Number(
    new RegExp(`--${name}=([\\d.]+)`).exec(process.argv.join(" "))?.[1] ??
      fallback,
  );
const MINUTES = arg("minutes", 2);
const RUNS = arg("runs", 6);
/** Seconds to hold eight platters turning, so the CPU can be read from outside. 0 skips it. */
const HOLD = arg("hold", 0);
const KEY = process.argv.includes("--key");
const SESSION = "m9:put-on";
const RATE = 48000;

/** One stereo PCM wav of `bits`. 16 for a record, 24 for a stem — which is what `wavPcm24` writes,
 *  and it matters: both are INTEGER, so both take the engine's direct read (docs/turntable.md). */
function wav(path: string, seconds: number, bits: 16 | 24): void {
  const n = Math.round(RATE * seconds);
  const bytes = bits / 8;
  const data = Buffer.alloc(n * 2 * bytes);
  const top = 2 ** (bits - 1) - 1;
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.2 * top);
    for (let c = 0; c < 2; c++) data.writeIntLE(v, (i * 2 + c) * bytes, bytes);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2 * bytes, 28);
  h.writeUInt16LE(2 * bytes, 32);
  h.writeUInt16LE(bits, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

const root = mkdtempSync(
  join(process.env.STUDIO_SCRATCH ?? tmpdir(), "m9-puton-"),
);
const seconds = MINUTES * 60;

/** Two plain records and two separated ones, so every step is a real change of file. */
function make(name: string, stems: boolean): { path: string; stems: boolean } {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "original.wav");
  wav(path, seconds, 16);
  if (stems) {
    mkdirSync(join(dir, "stems"), { recursive: true });
    for (const s of STEMS) wav(join(dir, "stems", `${s}.wav`), seconds, 24);
  }
  return { path, stems };
}

console.log(
  `préparation : 2 disques simples et 2 séparés, ${MINUTES} min chacun…`,
);
const records = [
  make("plainA", false),
  make("sepC", true),
  make("plainB", false),
  make("sepD", true),
];

/** The set as it is scaffolded: each deck's lane, plus a lane per stem. */
const base: ProjectDoc = (() => {
  const empty = deckDoc(NO_LOADS);
  return {
    ...empty,
    tracks: [
      ...empty.tracks,
      ...DECKS.flatMap((d) => STEMS.map((s) => trackDoc(stemLane(d, s)))),
    ],
  };
})();

const loadsFor = (r: { path: string; stems: boolean }): DeckLoads => ({
  deckA: {
    path: r.path,
    title: "A",
    artist: null,
    id: "songs/a",
    ...(r.stems ? { stems: true } : {}),
  },
  deckB: null,
});

/** Both decks separated and turning — eight platters, which is the heaviest the desk ever is. */
function holdEight() {
  const [, sepC, , sepD] = records;
  console.log("");
  console.log(
    `huit plateaux tournent, KEY ${KEY ? "allumé" : "éteint"}, pendant ${HOLD} s.`,
  );
  console.log("  lisez le CPU du moteur maintenant, puis à la fin.");
  send({
    type: "project",
    doc: withDecks(
      base,
      {
        deckA: {
          path: sepC.path,
          title: "A",
          artist: null,
          id: "songs/a",
          stems: true,
        },
        deckB: {
          path: sepD.path,
          title: "B",
          artist: null,
          id: "songs/b",
          stems: true,
        },
      },
      KEY
        ? {
            deckA: {
              natural: 120,
              seconds: MINUTES * 60,
              target: 126,
              keylock: true,
            },
            deckB: {
              natural: 120,
              seconds: MINUTES * 60,
              target: 126,
              keylock: true,
            },
          }
        : {},
      null,
      { deckA: true, deckB: true },
    ),
  });
  setTimeout(() => {
    send({ type: "drop-session" });
    console.log("fini.");
    process.exit(0);
  }, HOLD * 1000);
}

const ws = new WebSocket(url);
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));

let step = -1;
let sentAt = 0;
/** Milliseconds per step, kept apart by how many platters the step had to load. */
const took: { one: number[]; four: number[] } = { one: [], four: [] };

function next() {
  step++;
  if (step >= RUNS * 2 + 1) return report();
  const record = records[step % records.length];
  sentAt = performance.now();
  send({ type: "project", doc: withDecks(base, loadsFor(record)) });
}

ws.on("open", next);

ws.on("message", (data: Buffer) => {
  const msg = JSON.parse(String(data));
  if (msg.type !== "applied") return;
  const ms = performance.now() - sentAt;
  // The FIRST step is the warm-up: an empty engine loading its first record is a different question.
  if (step > 0)
    (records[step % records.length].stems ? took.four : took.one).push(ms);
  next();
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
}

function report() {
  const one = median(took.one);
  const four = median(took.four);
  console.log("");
  console.log(
    `poser un disque sur une platine qui en tient déjà un, ${MINUTES} min`,
  );
  console.log(
    `  un disque simple   : ${one.toFixed(0)} ms   (${took.one.length} fois)`,
  );
  console.log(
    `  un disque séparé   : ${four.toFixed(0)} ms   (${took.four.length} fois, 4 plateaux)`,
  );
  console.log(`  surcoût            : ${(four - one).toFixed(0)} ms`);
  console.log(
    "\nLe seuil qui compte est celui où un geste se sent comme un à-coup, autour de 100 ms.",
  );
  if (HOLD > 0) return holdEight();
  send({ type: "drop-session" });
  process.exit(0);
}
