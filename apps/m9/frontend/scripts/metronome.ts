// metronome.ts — is the click ON the deck's beat? Point it at a running engine.
//
// The engine's own metronome clicks on the DOCUMENT's grid, which in m9 has nothing to do with
// where the music's beat is (see ../docs/bpm.md), so m9 writes the click track itself. Whether
// that lands is a question about a sound, and this is how it gets answered: the deck plays a
// SILENT file, so everything the broadcast tap hears is the click, and each onset is compared
// against where that deck's grid says a beat belongs.
//
// It then moves the tempo the way a drag does and asks the same question again, because the
// click clip is rebuilt every time and the second placement is the one that can be wrong.
//
// Usage:  npx tsx apps/m9/frontend/scripts/metronome.ts [ws://127.0.0.1:8765]
// STUDIO_SCRATCH: a directory both sides can reach — see tempo-drag.ts.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DeckLoads,
  type DeckTempos,
  deckDoc,
  MIX_CENTRE,
  metronomeDeck,
  nudgedTempos,
  sourceAt,
  TIMELINE_BASE,
  transportAt,
} from "@studio/ui-turntables/deck";
import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:metronome";
const RATE = 48000;
const SECONDS = 60;
const NATURAL = 128;
const PHASE = 0.37; // where this "song" says its first beat is, in source seconds

/** A silent file: the deck has to hold something, and anything audible would mask the click. */
function silence(): string {
  const pcm = Buffer.alloc(RATE * SECONDS * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  const file = join(
    mkdtempSync(join(process.env.STUDIO_SCRATCH ?? tmpdir(), "m9-click-")),
    "silence.wav",
  );
  writeFileSync(file, Buffer.concat([h, pcm]));
  return file;
}

/** The same file, named the way the ENGINE will have to open it. Identity everywhere but WSL. */
function asEngineSees(path: string): string {
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(path);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}` : path;
}

const loads: DeckLoads = {
  deckA: {
    id: "silence",
    title: "silence",
    artist: null,
    path: asEngineSees(silence()),
  },
  deckB: null,
};
let tempos: DeckTempos = {
  deckA: { natural: NATURAL, seconds: SECONDS, target: NATURAL, phase: PHASE },
};

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));

const chunks: Float32Array[] = [];
let total = 0;
let changedAt = 0; // where in the captured stream the tempo moved
let transport = 0;
let heardAt = 0;
let rolling = false;

/** Where the deck is in its file — the same reading the desk's own `sourceOf` takes. */
const sourceOf = () =>
  sourceAt(
    transport + (rolling ? (performance.now() - heardAt) / 1000 : 0),
    tempos.deckA,
  );

const push = () => {
  const click = metronomeDeck(loads, tempos, null);
  if (!click) {
    console.log(
      "metronomeDeck refused — one deck with a measured beat should qualify",
    );
    process.exit(1);
  }
  send({ type: "project", doc: deckDoc(loads, MIX_CENTRE, {}, tempos, click) });
};

ws.on("open", () => {
  push();
  send({ type: "transport", action: "seek", position: TIMELINE_BASE });
  send({ type: "transport", action: "play" });
  send({ type: "broadcast", on: true });
  // Halfway through, move the tempo the way a drag does. The click clip is rebuilt, and its
  // second placement is the one that can be wrong.
  setTimeout(() => {
    // Through the real gesture, so the deck's SLIP moves too — the click has to follow the
    // grid where the pitch fader left it, not where it started.
    tempos = nudgedTempos(tempos, null, null, "deckA", 136, sourceOf);
    changedAt = total;
    push();
  }, 7000);
  setTimeout(finish, 14000);
});

ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
  if (!isBinary) {
    try {
      const j = JSON.parse(String(data));
      if (j.type === "state" && j.session === SESSION) {
        transport = j.playhead;
        heardAt = performance.now();
        rolling = j.playing === true;
      }
    } catch {
      /* not ours */
    }
    return;
  }
  const buf =
    data instanceof ArrayBuffer
      ? data
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x4c535452) return;
  const ch = dv.getUint8(5);
  const frames = dv.getUint32(12, true);
  const all = new Float32Array(buf, 32, frames * ch);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = all[i * ch];
  chunks.push(mono);
  total += frames;
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

function finish() {
  send({ type: "transport", action: "stop" });
  send({ type: "broadcast", on: false });
  send({ type: "drop-session" });

  const buf = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.length;
  }
  // One onset per click: a rise over the floor, with a lockout shorter than a beat.
  const onsets: number[] = [];
  let last = -RATE;
  for (let i = 0; i < buf.length; i++)
    if (Math.abs(buf[i]) > 0.02 && i - last > RATE * 0.1) {
      onsets.push(i / RATE);
      last = i;
    }
  if (onsets.length < 8) {
    console.log(`only ${onsets.length} clicks — the track is not clicking`);
    process.exit(1);
  }

  // The capture starts at an unknown transport second, so the tap's own offset is measured
  // once from the FIRST click and every later one is checked against the grid from there.
  const gridOf = (t: NonNullable<DeckTempos["deckA"]>) => {
    const period = 60 / t.target;
    const first = transportAt(t.phase ?? 0, t);
    return { period, first };
  };
  const before = gridOf({
    natural: NATURAL,
    seconds: SECONDS,
    target: NATURAL,
    phase: PHASE,
  });
  const after = gridOf(tempos.deckA!); // slip and all, as the drag left it
  const split = changedAt / RATE;
  // Capture time -> transport time, from the first click, which is on a beat by construction.
  const offset =
    onsets[0] -
    (before.first +
      Math.round((onsets[0] - before.first) / before.period) * before.period);

  const check = (list: number[], g: { period: number; first: number }) => {
    let worst = 0;
    for (const o of list) {
      const t = o - offset;
      const k = Math.round((t - g.first) / g.period);
      worst = Math.max(worst, Math.abs(t - (g.first + k * g.period)));
    }
    return worst * 1000;
  };
  // A click near the rebuild belongs to neither placement — skip a beat either side of it.
  const early = onsets.filter((o) => o < split - before.period);
  const late = onsets.filter((o) => o > split + after.period);

  console.log(`${onsets.length} clicks over ${(total / RATE).toFixed(1)}s`);
  console.log(
    `on the beat, at ${NATURAL} BPM : worst ${check(early, before).toFixed(1)}ms  (${early.length} clicks)`,
  );
  console.log(
    `…and after the drag to 136   : worst ${check(late, after).toFixed(1)}ms  (${late.length} clicks)`,
  );
  setTimeout(() => process.exit(0), 300);
}
