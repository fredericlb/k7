// turntable.ts — does the PLATTER follow a hand? Point it at a running engine.
//
//   npx tsx engine/st0-engine/scripts/turntable.ts [ws://127.0.0.1:8765] [--still]
//
// The clip-moving answer was measured and refused: a third of a beat of error, worse the faster it
// was driven (packages/ui-turntables/docs/scratch.md). This asks the same question of the platter.
//
// It does NOT use that bench's source, and the reason is the whole method here. There, position was
// encoded as FREQUENCY, which is readable only because `elastique` preserves pitch. A platter is a
// varispeed: it moves the pitch WITH the speed, so a tone would report position × rate.
//
// Turned round, that is the better measurement. A varispeed multiplies frequency by exactly the
// rate, so a CONSTANT tone is an exact tachometer — and a scratch's question is whether the audio
// follows the hand's SPEED. What a tone cannot give is the sign, a backwards tone sounding like a
// forwards one, so the file also ramps in AMPLITUDE: coarse, monotonic, and enough to say which way.
// See docs/turntable.md.

import WebSocket from "ws";
import {
  onBroadcast,
  peakHz,
  platterDoc,
  PLUGIN,
  writeWav,
} from "./platterBench";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const SESSION = "m9:turntable";
/** `--still` drives a plain rate of 1 and measures anyway — the bench's own floor, as the clip bench had. */
const STILL = process.argv.includes("--still");
/** `--slow` is the SECOND floor: the same swing spread over four times as long.
 *
 * The analysis window is 43 ms and reports an average, so a rate that swings ±2 twice a second moves
 * by half a turn INSIDE one window and the reading smears. Slowing the gesture without changing
 * anything else separates that from the platter's own error — see docs/turntable.md. */
const SLOW = process.argv.includes("--slow");

const RATE = 48000;
const SECONDS = 30;
/** The carrier. Read back, `heard / TONE` IS the rate the platter is running at. */
const TONE = 1000;
/** The envelope: amplitude from `A0` to `A0 + ASLOPE × seconds`, which is where the SIGN comes from. */
const A0 = 0.05;
const ASLOPE = 0.03;
/** The gesture: two seconds of a hand going back and forth, ±2× play speed — an ordinary scratch. */
const GESTURE_MS = SLOW ? 8000 : 2000;
const CYCLES = SLOW ? 1 : 2;
const SWING = 2;
/** How often the hand's speed is sent. 60 Hz is a pointer; the plugin glides between them. */
const STEP_MS = 16;

/** One tone, one ramp: the frequency says the SPEED and the level says roughly WHERE. */
function chirp(): string {
  const n = RATE * SECONDS;
  const pcm = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * TONE) / RATE;
    const amp = A0 + (ASLOPE * i) / RATE;
    pcm[i] = Math.round(Math.sin(phase) * amp * 32767);
  }
  return writeWav(pcm, RATE, "platter");
}

const source = chirp();

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));

const chunks: Float32Array[] = [];
let total = 0;
/** The speed asked for, against the tape position it was asked at — the comparison. */
const asked: { sample: number; rate: number }[] = [];

ws.on("open", () => {
  send({ type: "project", doc: platterDoc(source, RATE) });
  // The transport rolls because the graph needs it to; the platter's position is its OWN.
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

let started = 0;
function step() {
  const u = (performance.now() - started) / GESTURE_MS;
  if (u >= 1) {
    send({ type: "set-plugin-param", id: PLUGIN, name: "Rate", value: 1 });
    return setTimeout(finish, 2000);
  }
  // A hand's SPEED, which is what a hand actually imparts — reverse is just a negative one.
  const rate = STILL ? 1 : SWING * Math.cos(2 * Math.PI * CYCLES * u);
  send({ type: "set-plugin-param", id: PLUGIN, name: "Rate", value: rate });
  asked.push({ sample: total, rate });
  setTimeout(step, STEP_MS);
}

setTimeout(() => {
  started = performance.now();
  step();
}, 6000);

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
  const HOP = 256;
  const WIN = 2048;
  /** Per window: the SPEED off the tone, and the level, which says which way it is going. */
  const pts: { t: number; speed: number | null; level: number }[] = [];
  for (let i = 0; i + WIN <= buf.length; i += HOP) {
    const w = buf.subarray(i, i + WIN);
    let sq = 0;
    for (const v of w) sq += v * v;
    const rmsW = Math.sqrt(sq / w.length);
    // Below this a tone is not resolvable, and a platter at rest genuinely emits nothing.
    pts.push({
      t: i / RATE,
      speed: rmsW < 3e-4 ? null : peakHz(w, RATE) / TONE,
      level: rmsW,
    });
  }

  const from = asked[0].sample / RATE;
  const to = asked[asked.length - 1].sample / RATE;
  const during = pts.filter((p) => p.t >= from && p.t <= to);
  const quiet = during.filter((p) => p.speed === null).length;
  const heard = during.filter((p) => p.speed !== null) as {
    t: number;
    speed: number;
    level: number;
  }[];

  /** What was asked for at that moment on the tape — a step function, as it was sent, in MAGNITUDE. */
  const wantAt = (t: number) => {
    let r = asked[0].rate;
    for (const a of asked) if (t >= a.sample / RATE) r = a.rate;
    return Math.abs(r);
  };

  // The MAGNITUDE, which the tone gives outright. Signing it per window was tried and thrown away:
  // the envelope moves 0.0006 over the interval a window compares, which is noise, so the sign was
  // a coin toss and the "error" it produced was the bench's. Direction is checked in the large below.
  const signed = heard.map((p) => ({ t: p.t, rate: p.speed }));

  /** Near a turnaround the tone falls to nothing and the envelope cannot say which way it is going,
   * so the SIGN is the bench's guess there, not the platter's doing. Reported apart rather than
   * folded in — a number whose worst case is an artefact of measuring is not a number. */
  const TURN = 0.3;
  const score = (ps: typeof signed) => {
    let sum = 0;
    let worst = 0;
    for (const p of ps) {
      const e = Math.abs(p.rate - wantAt(p.t));
      sum += e * e;
      worst = Math.max(worst, e);
    }
    return {
      rms: ps.length ? Math.sqrt(sum / ps.length) : Number.NaN,
      worst,
      n: ps.length,
    };
  };
  const all = score(signed);
  const away = score(signed.filter((p) => Math.abs(wantAt(p.t)) >= TURN));
  const rms = all.rms;
  const worst = all.worst;
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

  console.log(
    STILL
      ? "plancher (débit 1, aucun geste)"
      : SLOW
        ? "le MÊME geste, huit fois plus lent"
        : "un scratch",
  );
  console.log(`pas envoyés          : ${asked.length} (un / ${STEP_MS} ms)`);
  console.log(
    `débit demandé        : ${Math.min(...asked.map((a) => a.rate)).toFixed(2)} … ${Math.max(...asked.map((a) => a.rate)).toFixed(2)} ×`,
  );
  console.log(
    `|débit| entendu      : ${Math.min(...signed.map((p) => p.rate)).toFixed(2)} … ${Math.max(...signed.map((p) => p.rate)).toFixed(2)} ×`,
  );
  // Direction, checked in the large where the envelope has travelled enough to say: the record must
  // end up BEHIND where it started, the gesture being symmetric and ending mid-swing.
  const netLevel = heard[heard.length - 1].level - heard[0].level;
  console.log(
    `marche arrière       : ${netLevel < 0 ? "OUI" : "non"} (le niveau a ${netLevel < 0 ? "baissé" : "monté"} de ${Math.abs(netLevel).toFixed(4)})`,
  );
  console.log(`erreur RMS sur le débit : ${rms.toFixed(3)} ×  (toutes fenêtres)`);
  console.log(
    `  … hors demi-tour      : ${away.rms.toFixed(3)} ×  (${away.n}/${all.n} fenêtres, |débit| ≥ ${TURN})`,
  );
  console.log(`pire écart              : ${worst.toFixed(3)} ×`);
  console.log(`  … hors demi-tour      : ${away.worst.toFixed(3)} ×`);
  console.log(`amplitude du geste      : ${spread(asked.map((a) => a.rate)).toFixed(2)} ×`);
  console.log(
    `fenêtres muettes     : ${quiet}/${during.length} (${((100 * quiet) / (during.length || 1)).toFixed(0)} %)`,
  );
  process.exit(0);
}
