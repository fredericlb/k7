// keylock.ts — KEY holds the PITCH while the tempo moves. Point it at a running engine.
//
//   npx tsx engine/moteur/scripts/keylock.ts [ws://127.0.0.1:8765]
//
// A tone alone cannot answer this: it has a pitch and no tempo, so a stretcher leaves it untouched
// and the bench would pass by doing nothing. The source is therefore a tone that is CHOPPED — 1 kHz
// in bursts at a fixed period — so one file carries both quantities and they are read apart:
//
//   the carrier inside a burst -> the PITCH        KEY on: unmoved. KEY off: multiplied by the rate.
//   the interval between bursts -> the TEMPO       both:  divided by the rate.
//
// The same run then jumps the needle and measures the HOLE it leaves, in both modes: a stretcher
// holds audio from before the jump, so it has to be emptied, and what that costs is the question.
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
const SESSION = "m9:keylock";

const RATE = 48000;
const SECONDS = 90;
/** The carrier, which is the PITCH the run is about. */
const TONE = 1000;
/** The burst: this long on, this long off. Their sum is the TEMPO the run is about. */
const ON_MS = 120;
const OFF_MS = 80;
const PERIOD_MS = ON_MS + OFF_MS;
const AMP = 0.25;
/** The rates held, each for `HOLD_MS` — ±16 %, a deck's own pitch fader, plus its neutral. */
const RATES = [1, 1.16, 0.84];
const HOLD_MS = 4000;
/** How long a plateau is left to settle before anything in it is read. */
const SETTLE_MS = 1200;

/** A tone chopped at a fixed period: the carrier says the pitch, the chopping says the tempo. */
function bursts(): string {
  const n = RATE * SECONDS;
  const pcm = new Int16Array(n);
  const on = (ON_MS * RATE) / 1000;
  const period = (PERIOD_MS * RATE) / 1000;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * TONE) / RATE;
    // The edges are ramped over a millisecond: a hard gate is a click, and clicks are what is measured.
    const at = i % period;
    const ramp = (RATE / 1000) * 1;
    const w = at >= on ? 0 : Math.min(1, at / ramp, (on - at) / ramp);
    pcm[i] = Math.round(Math.sin(phase) * w * AMP * 32767);
  }
  return writeWav(pcm, RATE, "keylock");
}

const source = bursts();

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));
const set = (name: string, value: number) =>
  send({ type: "set-plugin-param", id: PLUGIN, name, value });

const chunks: Float32Array[] = [];
let total = 0;
/** What was asked, and the tape position it was asked at — the only clock both sides share. */
const marks: { sample: number; label: string; key: boolean; rate: number }[] =
  [];

ws.on("open", () => {
  send({ type: "project", doc: platterDoc(source, RATE) });
  // The transport rolls because the graph needs it to; the platter's position is its OWN.
  send({ type: "transport", action: "play" });
  send({ type: "broadcast", on: true });
});

const origin = onBroadcast(ws, RATE, (mono) => {
  chunks.push(mono);
  total += mono.length;
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

/** Where the ENGINE says the needle is, against the wall clock — the state frame, at its own 20 Hz. */
const needles: { at: number; seconds: number }[] = [];
ws.on("message", (data: Buffer, isBinary: boolean) => {
  if (isBinary) return;
  const msg = JSON.parse(String(data));
  const seconds = msg?.platters?.[PLUGIN];
  if (msg.type === "state" && typeof seconds === "number")
    needles.push({ at: performance.now(), seconds });
});

/** The whole run as a list of moments: set these params, call this stretch of tape that. */
const plan: { key: boolean; rate: number; label: string }[] = [];
for (const key of [true, false])
  for (const rate of RATES)
    plan.push({ key, rate, label: `${key ? "KEY" : "varispeed"} ${rate}×` });

let step = 0;
function next() {
  if (step >= plan.length) {
    // A closing mark, so the LAST plateau ends where it ends rather than at the end of the take.
    marks.push({ sample: total, label: "", key: false, rate: 1 });
    return seekTest();
  }
  const { key, rate, label } = plan[step++];
  set("Key", key ? 1 : 0);
  set("Rate", rate);
  marks.push({ sample: total, label, key, rate });
  setTimeout(next, HOLD_MS);
}

/** The needle-drop, run twice: what a jump costs with the stretcher in the way, and without. */
const seeks: { sample: number; key: boolean }[] = [];
let seekStep = 0;
function seekTest() {
  if (seekStep >= 2) return startTest();
  const key = seekStep++ === 0;
  set("Key", key ? 1 : 0);
  set("Rate", 1);
  setTimeout(() => {
    // Mid-burst on purpose: a jump landing in a silence would flatter the measurement.
    set("Seek", 0.3 + seekStep * 0.05);
    seeks.push({ sample: total, key });
    setTimeout(seekTest, 2500);
  }, 2500);
}

/** How many times each mode is started from a standstill — the reading is a median of these. */
const STARTS = 8;
/** Each start: when Rate went to 1, and where the tape was — the two clocks, joined by `origin`. */
const starts: {
  sent: number;
  sample: number;
  key: boolean;
  from: number;
}[] = [];
let startStep = 0;

/** A burst BEGINS at every whole period, and that is where each run is made to start from.
 *
 * Landing mid-silence would add a random 0–80 ms to the reading, which is the size of the answer.
 * `k` differs every run so the value CHANGES: a param carries a level, and a repeat is not a jump. */
const burstStart = (k: number) =>
  ((k * PERIOD_MS) / 1000 / SECONDS) % 1;

function startTest() {
  if (startStep >= STARTS * 2) return setTimeout(finish, 1500);
  const key = startStep % 2 === 0;
  const k = 100 + startStep;
  startStep++;
  set("Key", key ? 1 : 0);
  set("Rate", 0);
  set("Seek", burstStart(k));
  setTimeout(() => {
    const from = burstStart(k) * SECONDS;
    starts.push({ sent: performance.now(), sample: total, key, from });
    set("Rate", 1);
    setTimeout(startTest, 900);
  }, 700);
}

setTimeout(next, 5000);

/** RMS per short window across the whole take — the one reading everything below is derived from. */
function windows(buf: Float32Array, hopMs: number, winMs: number) {
  const hop = Math.round((hopMs * RATE) / 1000);
  const win = Math.round((winMs * RATE) / 1000);
  const out: { t: number; rms: number }[] = [];
  for (let i = 0; i + win <= buf.length; i += hop) {
    let sq = 0;
    for (let k = i; k < i + win; k++) sq += buf[k] * buf[k];
    out.push({ t: i / RATE, rms: Math.sqrt(sq / win) });
  }
  return out;
}

/** The period an envelope repeats at, in ms — autocorrelation, since counting fronts cannot survive
 *  a ragged burst. A stretcher SPLICES, so its output dips mid-burst and every dip is a false front. */
function periodMs(env: { t: number; rms: number }[], hopMs: number): number {
  const e = env.map((w) => w.rms);
  const mean = e.reduce((a, b) => a + b, 0) / e.length;
  const d = e.map((v) => v - mean);
  const energy = d.reduce((a, b) => a + b * b, 0);
  const lo = Math.round(50 / hopMs);
  const hi = Math.min(Math.round(400 / hopMs), Math.floor(d.length / 2));
  const r: number[] = [];
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
    r.push(s / (energy || 1));
  }
  const best = Math.max(...r);
  // The SMALLEST lag that is as good, not the strongest: twice a period correlates just as well.
  const at = r.findIndex((v) => v >= best * 0.95);
  return (lo + at) * hopMs;
}

/** The longest run of quiet in a stretch of envelope, in ms — what a hole is, measured. */
function quietMs(
  env: { t: number; rms: number }[],
  from: number,
  to: number,
  gate: number,
  hopMs: number,
): number {
  let run = 0;
  let worst = 0;
  for (const w of env) {
    if (w.t < from || w.t > to) continue;
    run = w.rms < gate ? run + 1 : 0;
    worst = Math.max(worst, run);
  }
  return worst * hopMs;
}

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
  const HOP = 1;
  const env = windows(buf, HOP, 4);
  /** Half the loudest window: above it a burst is sounding, below it the gap between two. */
  const gate = Math.max(...env.map((w) => w.rms)) / 2;

  console.log(`porteuse ${TONE} Hz, salves ${ON_MS}/${OFF_MS} ms`);
  console.log("");
  console.log("mode             débit   hauteur    attendu    période   attendue   écart");

  for (let i = 0; i < marks.length - 1; i++) {
    const from = marks[i].sample / RATE + SETTLE_MS / 1000;
    const to = marks[i + 1].sample / RATE - 0.2;
    if (to <= from) continue;
    const slice = env.filter((w) => w.t >= from && w.t <= to);
    // The pitch, off a window taken INSIDE a burst — the loudest one in the plateau will do.
    const start = Math.round(
      [...slice].sort((a, b) => b.rms - a.rms)[0].t * RATE,
    );
    const hz = peakHz(buf.subarray(start, start + 2048), RATE);
    const ms = periodMs(slice, HOP);
    const { label, key, rate } = marks[i];
    const wantHz = key ? TONE : TONE * rate;
    const wantMs = PERIOD_MS / rate;
    console.log(
      `${label.padEnd(17)}${rate.toFixed(2)}×` +
        `${hz.toFixed(0).padStart(7)} Hz${wantHz.toFixed(0).padStart(8)} Hz` +
        `${ms.toFixed(0).padStart(9)} ms${wantMs.toFixed(0).padStart(8)} ms` +
        `${(100 * (ms / wantMs - 1)).toFixed(1).padStart(8)} %`,
    );
  }

  console.log("");
  console.log("le trou qu'un saut laisse, contre la seconde qui le précède");
  for (const s of seeks) {
    const t0 = s.sample / RATE;
    const hole = quietMs(env, t0, t0 + 1, gate, HOP);
    // The control: the same reading a second EARLIER, where a burst's own silence is all there is.
    const floor = quietMs(env, t0 - 1.2, t0 - 0.2, gate, HOP);
    console.log(
      `  ${(s.key ? "KEY" : "varispeed").padEnd(12)}` +
        `${hole.toFixed(0).padStart(4)} ms de silence` +
        `   (témoin ${floor.toFixed(0)} ms, donc ${(hole - floor).toFixed(0)} ms de trou)`,
    );
  }

  console.log("");
  console.log("ce que KEY retarde, mesuré au démarrage depuis l'arrêt");
  const t0 = origin();
  for (const key of [false, true]) {
    const got: number[] = [];
    for (const s of starts.filter((x) => x.key === key)) {
      // From the WALL CLOCK, not from the frames received: the stream lags, and the lag is the answer.
      const from = (s.sent - t0) / 1000 - 0.1;
      const heard = env.find((w) => w.t >= from && w.rms >= gate);
      if (heard) got.push(t0 + heard.t * 1000 - s.sent);
    }
    got.sort((a, b) => a - b);
    const median = got[Math.floor(got.length / 2)];
    console.log(
      `  ${(key ? "KEY" : "varispeed").padEnd(12)}` +
        `médiane ${(median ?? Number.NaN).toFixed(1).padStart(6)} ms` +
        `   (${got.length}/${STARTS} départs, ${(got[0] ?? Number.NaN).toFixed(1)} … ${(got[got.length - 1] ?? Number.NaN).toFixed(1)})`,
    );
  }
  console.log("");
  console.log("ce que l'aiguille RAPPORTE, contre le temps qui a passé");
  for (const key of [false, true]) {
    const got: number[] = [];
    for (const s of starts.filter((x) => x.key === key)) {
      // Half a second in, so the platter is well launched and the reading is not the launch itself.
      const n = needles.find((x) => x.at >= s.sent + 500);
      if (n) got.push((n.seconds - s.from) * 1000 - (n.at - s.sent));
    }
    got.sort((a, b) => a - b);
    console.log(
      `  ${(key ? "KEY" : "varispeed").padEnd(12)}` +
        `médiane ${(got[Math.floor(got.length / 2)] ?? Number.NaN).toFixed(1).padStart(6)} ms d'avance` +
        `   (${got.length} départs)`,
    );
  }
  console.log(
    "\nL'aiguille doit dire ce qui SORT : c'est le nombre sur lequel un repère se pose. Un étireur\n" +
      "lit en avance, donc le plateau retranche cette avance — les deux lignes doivent se valoir.",
  );

  console.log(
    `\nSeule la DIFFÉRENCE des deux se lit : l'origine du flux est estimée sur la trame la moins\n` +
      `retardée, donc elle penche tôt et décale les DEUX lignes du même biais. Ce qui reste entre\n` +
      `elles est ce que l'étireur ajoute, le chemin étant commun par ailleurs.`,
  );
  process.exit(0);
}
