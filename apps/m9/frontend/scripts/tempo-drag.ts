// tempo-drag.ts — does moving the BPM fader move the MUSIC? Point it at a running engine.
//
// The one question a unit test cannot answer, because the answer is a sound. It drives the real
// `nudgedTempos` and `deckDoc` — the same functions the desk calls — against a source whose
// frequency encodes its own position, so the tone coming back says which source second is
// playing. Music that skips shows up as a step in that number. See ../docs/bpm.md.
//
// Usage:  npx tsx apps/m9/frontend/scripts/tempo-drag.ts [ws://127.0.0.1:8765] [--raw]
//   --raw   drop the slip correction, to measure what the fader used to do
//   --down  drag the fader DOWN — the direction that needs the timeline's headroom
//
// STUDIO_SCRATCH names a directory BOTH sides can reach, for the Windows dev machine where the
// script runs under WSL and the engine does not: the engine opens file paths, so a Linux tmpdir
// is a file it cannot see. Unset, an ordinary tmpdir is right and nothing below applies.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DeckLoads,
  type DeckTempos,
  deckDoc,
  nudgedTempos,
  sourceAt,
  TIMELINE_BASE,
} from "@studio/ui-turntables/deck";
import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const RAW = process.argv.includes("--raw");
const SESSION = "m9:tempo-drag";

const RATE = 48000;
const SECONDS = 60;
const F0 = 300; // Hz at source second 0
const SLOPE = 80; // Hz per source second
const NATURAL = 120;
const STEPS = 8;
const STEP_MS = 120;
const FINAL = NATURAL * (process.argv.includes("--down") ? 0.92 : 1.08);

// --- a file whose frequency IS its position ---------------------------------------------
// elastique preserves pitch, so stretching does not move the tone: whatever is heard says
// where in the file it came from, independently of how fast it is being played.
function chirp(): string {
  const n = RATE * SECONDS;
  const pcm = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * (F0 + (SLOPE * i) / RATE)) / RATE;
    pcm.writeInt16LE(Math.round(Math.sin(phase) * 0.03 * 32767), i * 2); // quiet: it plays out loud
  }
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
    mkdtempSync(join(process.env.STUDIO_SCRATCH ?? tmpdir(), "m9-tempo-")),
    "chirp.wav",
  );
  writeFileSync(file, Buffer.concat([h, pcm]));
  return file;
}

/** The same file, named the way the ENGINE will have to open it. Identity everywhere but WSL. */
function asEngineSees(path: string): string {
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(path);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}` : path;
}

// --- the loudest frequency in a block, to a fraction of a bin ----------------------------
function peakHz(x: Float32Array): number {
  const n = 4096;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++)
    re[i] = (x[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1)
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const ang = (-2 * Math.PI * k) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  let best = 1;
  let bm = 0;
  for (let k = 1; k < n / 2; k++) {
    const m = re[k] * re[k] + im[k] * im[k];
    if (m > bm) [bm, best] = [m, k];
  }
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  const l = mag(best - 1);
  const c = Math.sqrt(bm);
  const r = mag(best + 1);
  return ((best + (0.5 * (l - r)) / (l - 2 * c + r || 1)) * RATE) / n;
}

// --- drive ------------------------------------------------------------------------------
const source = chirp();
const loads: DeckLoads = {
  deckA: {
    id: "chirp",
    title: "chirp",
    artist: null,
    path: asEngineSees(source),
  },
  deckB: null,
};

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
const send = (m: Record<string, unknown>) =>
  ws.send(JSON.stringify({ ...m, session: SESSION }));

let faders: DeckTempos = {
  deckA: { natural: NATURAL, seconds: SECONDS, target: NATURAL },
};
let transport = 0;
let heardAt = 0;
let playing = false;
const chunks: Float32Array[] = [];
let total = 0;
const marks: { sample: number; rate: number }[] = [];

/** Where deck A is in its file, extrapolated between the engine's pushes — exactly `sourceOf`. */
const sourceOf = () =>
  sourceAt(
    transport + (playing ? (performance.now() - heardAt) / 1000 : 0),
    faders.deckA,
  );

const push = () =>
  send({ type: "project", doc: deckDoc(loads, 0, {}, faders) });

ws.on("open", () => {
  push();
  send({ type: "transport", action: "seek", position: TIMELINE_BASE });
  send({ type: "transport", action: "play" });
  send({ type: "broadcast", on: true });
});

ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
  if (!isBinary) {
    try {
      const j = JSON.parse(String(data));
      // Every session's state arrives on this socket; another's playhead is not ours.
      if (j.type === "state" && j.session === SESSION) {
        transport = j.playhead;
        heardAt = performance.now();
        playing = j.playing === true;
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
  const channels = dv.getUint8(5);
  const frames = dv.getUint32(12, true);
  const all = new Float32Array(buf, 32, frames * channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = all[i * channels];
  chunks.push(mono);
  total += frames;
});

ws.on("error", (e: Error) => {
  console.error("socket:", e.message);
  process.exit(1);
});

let done = 0;
function step() {
  done++;
  const target = NATURAL + ((FINAL - NATURAL) * done) / STEPS;
  const next = nudgedTempos(faders, null, null, "deckA", target, sourceOf);
  // `--raw` keeps the new tempo and throws the slip away: the fader as it behaved before this
  // was measured, so the two runs differ in exactly one thing.
  faders = RAW ? { deckA: { ...faders.deckA!, target } } : next;
  push();
  marks.push({ sample: total, rate: target / NATURAL });
  setTimeout(done < STEPS ? step : finish, done < STEPS ? STEP_MS : 4000);
}
setTimeout(step, 12_000);

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
  const HOP = 1024;
  const pts: { t: number; src: number | null }[] = [];
  for (let i = 0; i + 4096 <= buf.length; i += HOP) {
    const w = buf.subarray(i, i + 4096);
    let peak = 0;
    for (const v of w) peak = Math.max(peak, Math.abs(v));
    pts.push({
      t: i / RATE,
      src: peak < 2e-4 ? null : (peakHz(w) - F0) / SLOPE,
    });
  }
  const first = marks[0].sample / RATE;
  const last = marks[marks.length - 1].sample / RATE;
  const rateAt = (t: number) => {
    let r = 1;
    for (const m of marks) if (t >= m.sample / RATE) r = m.rate;
    return r;
  };
  const nearest = (t: number) =>
    pts.reduce<{ t: number; src: number | null } | null>(
      (b, p) =>
        p.src !== null && (!b || Math.abs(p.t - t) < Math.abs(b.t - t)) ? p : b,
      null,
    );
  const a = nearest(first - 0.5);
  const b = nearest(last + 0.5);
  if (!a || !b || a.src === null || b.src === null) {
    console.log("no tone captured — is the engine playing, and is the tap on?");
    process.exit(1);
  }
  // Where ordinary playback would have carried it, integrating the schedule of rates.
  let expected = a.src;
  for (let t = a.t; t < b.t; t += 0.001) expected += 0.001 * rateAt(t);

  console.log(
    `${STEPS} steps to ${FINAL.toFixed(1)} BPM${RAW ? "  (RAW — no slip)" : ""}\n` +
      `MUSIC EATEN over the drag: ${((b.src - expected) * 1000).toFixed(0)}ms`,
  );
  setTimeout(() => process.exit(0), 300);
}
