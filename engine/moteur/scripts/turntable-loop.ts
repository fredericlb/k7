// turntable-loop.ts — does the platter really LOOP, and does a roll really hand the record back?
// Point it at a running engine.
//
//   npx tsx engine/moteur/scripts/turntable-loop.ts [ws://127.0.0.1:8765]
//
// `TurntableLoop_test.cpp` covers the arithmetic and nothing else: it cannot say whether
// `applyToBuffer` is wired to it. This can, because the source is built so that AMPLITUDE READS
// POSITION — a level that ramps linearly with time. A loop turns that ramp into a SAWTOOTH, and a
// roll's release is a STEP up to where the record would have reached. See docs/turntable.md.

import WebSocket from "ws";
import { onBroadcast, platterDoc, PLUGIN, writeWav } from "./platterBench";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:turntable-loop";

/** `--key` runs the whole thing through the STRETCHER, which is the other render path and the one
 *  where a wrap is not simply `position += rate`: it reads AHEAD, so what it swallowed and what has
 *  been heard are different numbers, and a loop moves one of them backwards. */
const KEY = process.argv.includes("--key");

const RATE = 48000;
const SECONDS = 40;
/** A carrier that is not measured here: only its ENVELOPE carries the answer. */
const TONE = 1000;
/** Amplitude at second `t` is `A0 + ASLOPE * t`, which is the whole method — invert it for a position. */
const A0 = 0.05;
const ASLOPE = 0.02;

/** Where the loop is put, in source seconds, and how long. Two seconds is four beats of the doc's 120. */
const LOOP_AT = 6;
const LOOP_LEN = 2;
/** …and the roll, elsewhere on the record so the two never share a stretch of tape. */
const ROLL_AT = 20;
const ROLL_LEN = 1;
const ROLL_HELD = 4;

/** A tone under a linear ramp: the level says WHERE on the record we are, to a few milliseconds. */
function ramp(): string {
  const n = RATE * SECONDS;
  const pcm = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * TONE) / RATE;
    pcm[i] = Math.round(Math.sin(phase) * (A0 + (ASLOPE * i) / RATE) * 32767);
  }
  return writeWav(pcm, RATE, "platter-loop");
}

/** The inverse: a peak level back into the source second it was cut at. */
const positionOf = (peak: number) => (peak - A0) / ASLOPE;

/** Peak of one window. A pure sine, so this is the envelope and needs no smoothing. */
function peak(x: Float32Array, from: number, n: number): number {
  let hi = 0;
  for (let i = from; i < Math.min(x.length, from + n); i++)
    hi = Math.max(hi, Math.abs(x[i]));
  return hi;
}

const source = ramp();
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));
const param = (name: string, value: number) =>
  send({ type: "set-plugin-param", id: PLUGIN, name, value });

const chunks: Float32Array[] = [];
let total = 0;
/** What was asked for, against the output sample it was asked at — the timeline of the run. */
const marks: { sample: number; what: string }[] = [];
const mark = (what: string) => marks.push({ sample: total, what });

ws.on("open", () => {
  send({ type: "project", doc: platterDoc(source, RATE, KEY ? { Key: 1 } : {}) });
  send({ type: "transport", action: "play" });
  send({ type: "broadcast", on: true });
});

onBroadcast(ws, RATE, (mono) => {
  chunks.push(mono);
  total += mono.length;
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  // Let the graph settle and the record get going before anything is asked of it.
  await wait(4000);

  mark("loop on");
  param("Roll", 0);
  param("LoopStart", LOOP_AT / SECONDS);
  param("LoopEnd", (LOOP_AT + LOOP_LEN) / SECONDS);
  // Three times round, so a sawtooth is a sawtooth and not one coincidence.
  await wait(LOOP_LEN * 3 * 1000);

  mark("loop off");
  // The END alone — the desk's rule, and the one order that cannot pull the record somewhere else.
  param("LoopEnd", 0);
  await wait(2000);

  mark("seek to roll");
  param("Seek", ROLL_AT / SECONDS);
  await wait(1500);

  mark("roll on");
  param("Roll", 1);
  param("LoopStart", ROLL_AT / SECONDS);
  param("LoopEnd", (ROLL_AT + ROLL_LEN) / SECONDS);
  await wait(ROLL_HELD * 1000);

  mark("roll off");
  param("LoopEnd", 0);
  await wait(2000);

  finish();
}

setTimeout(() => void run(), 500);

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

  // One reading every 50 ms — far finer than the two-second loop, far coarser than a click.
  const step = Math.round(RATE * 0.05);
  const read: { t: number; pos: number }[] = [];
  for (let i = 0; i + step < buf.length; i += step) {
    const p = peak(buf, i, step);
    if (p > A0 / 2) read.push({ t: i / RATE, pos: positionOf(p) });
  }

  const between = (a: string, b: string) => {
    const from = marks.find((m) => m.what === a);
    const to = marks.find((m) => m.what === b);
    if (!from || !to) return [];
    // A window INSIDE the two marks: the edges are where the change is still landing.
    return read.filter(
      (r) => r.t > from.sample / RATE + 0.4 && r.t < to.sample / RATE - 0.2,
    );
  };

  console.log(`\n--- ${KEY ? "STRETCHED (Key on)" : "varispeed (Key off)"} ---`);
  let bad = 0;
  const say = (ok: boolean, line: string) => {
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  };

  // --- the loop: the position must stay INSIDE the two edges, and must go backwards ---------
  const inside = between("loop on", "loop off");
  const lo = Math.min(...inside.map((r) => r.pos));
  const hi = Math.max(...inside.map((r) => r.pos));
  const backwards = inside.filter((r, i) => i > 0 && r.pos < inside[i - 1].pos - 0.2);
  console.log(
    `\nloop  [${LOOP_AT}, ${LOOP_AT + LOOP_LEN}] s — heard ${lo.toFixed(2)}…${hi.toFixed(2)} s, ` +
      `${backwards.length} wrap(s) in ${inside.length} readings`,
  );
  say(inside.length > 10, "the loop window was actually measured");
  // A quarter of a second of slack: the params land on a block boundary, not on a sample.
  say(lo > LOOP_AT - 0.25, `never before the loop's start (${lo.toFixed(2)} s)`);
  say(
    hi < LOOP_AT + LOOP_LEN + 0.25,
    `never past its end (${hi.toFixed(2)} s) — an unwired loop would ramp straight on`,
  );
  say(backwards.length >= 2, `it went round more than once (${backwards.length} wraps)`);

  // --- and OFF is off: the record leaves the loop and keeps going ---------------------------
  const after = between("loop off", "seek to roll");
  if (after.length > 2) {
    const last = after[after.length - 1].pos;
    say(
      last > LOOP_AT + LOOP_LEN,
      `closing it let the record run on (${last.toFixed(2)} s)`,
    );
  }

  // --- the roll: same containment, then a STEP to where the record would have been ----------
  //
  // The expectation is MEASURED, not assumed. The seek lands at ROLL_AT and the record keeps playing
  // until the roll engages, so the shadow starts wherever it had got to by then. Reading that off
  // the tape is the only way to compare against it without re-deriving this harness's own delays —
  // which is what the first version of this got wrong, and it read as an engine fault.
  const engaged = (what: string) =>
    (marks.find((m) => m.what === what)?.sample ?? 0) / RATE;
  const onAt = engaged("roll on");
  const offAt = engaged("roll off");
  const before = read.filter((r) => r.t < onAt);
  const began = before.length ? before[before.length - 1].pos : Number.NaN;

  const rolled = between("roll on", "roll off");
  const rhi = Math.max(...rolled.map((r) => r.pos));
  const rlo = Math.min(...rolled.map((r) => r.pos));
  // Half a second after the release, so the jump has landed and the reading is not on the seam.
  const back = read.filter((r) => r.t > offAt + 0.5);
  const landed = back.length ? back[0].pos : Number.NaN;
  // Where it began, plus how long it was held, plus what has played since the release.
  const owed = began + (offAt - onAt) + (back.length ? back[0].t - offAt : 0);
  console.log(
    `\nroll  [${ROLL_AT}, ${ROLL_AT + ROLL_LEN}] s, engaged at ${began.toFixed(2)} s and held ` +
      `${(offAt - onAt).toFixed(2)} s — heard ${rlo.toFixed(2)}…${rhi.toFixed(2)} s, ` +
      `released onto ${landed.toFixed(2)} s (owed ≈ ${owed.toFixed(2)})`,
  );
  // Engaged from OUTSIDE its own edges, so this also says a needle gets pulled INTO a loop.
  say(
    rhi < ROLL_AT + ROLL_LEN + 0.25 && rlo > ROLL_AT - 0.25,
    `the roll pulled the record in and kept it there (${rlo.toFixed(2)}…${rhi.toFixed(2)} s)`,
  );
  say(
    Math.abs(landed - owed) < 0.35,
    `it handed the record back where it would have reached (${landed.toFixed(2)} vs ${owed.toFixed(2)} s)`,
  );
  say(
    landed > ROLL_AT + ROLL_LEN,
    "…and NOT where the loop left it, which is what a plain loop would have done",
  );

  console.log(`\n${bad === 0 ? "all good" : `${bad} failure(s)`}`);
  ws.close();
  process.exit(bad === 0 ? 0 : 1);
}
