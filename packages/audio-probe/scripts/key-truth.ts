// key-truth.ts — the key detector against records whose key is KNOWN, and a sweep of the ideas
// that might make it better.
//
//   npx tsx packages/audio-probe/scripts/key-truth.ts [--verbose]
//
// The médiathèque carries no `TKEY` on any of its 302 files, so the labels below were given by
// hand. They are the only ground truth there is; without them the detector could only be measured
// against synthetic chords, which it already passes and which prove far less.
//
// In `scripts/` and not `src/`: this needs node:fs and ffmpeg, and the package is browser-safe.
// Same arrangement as ui-turntables' put-on.ts. See ../../../docs/key-detection-plan.md.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  camelot,
  compatible,
  type DetectedKey,
  KRUMHANSL,
  keyName,
  keyOf,
  type Mode,
  PITCH_CLASSES,
  TEMPERLEY,
} from "../src/key.ts";

const SONGS = "C:/Users/flb/.studio/mediatek/songs";
const VERBOSE = process.argv.includes("--verbose");

/** Artist folder, a fragment of the title folder, and the key — given by hand, not by a tag. */
const TRUTH: [string, string, string, Mode][] = [
  ["ABBA", "Money", "A", "minor"],
  ["Aqua", "Barbie", "C#", "minor"],
  ["Blackpink", "How you like", "C", "minor"],
  ["Chappell Roan", "Good Luck", "B", "minor"],
  ["Gorillaz", "Melancholy", "D", "major"],
  ["Las Ketchup", "Asejere", "C#", "major"],
  ["Justice", "Dance", "F#", "minor"],
  ["LCD Soundsystem", "Dance", "B", "major"],
  ["MGMT", "Kids", "A", "major"],
  ["Maneskin", "Zitti", "E", "minor"],
  ["Linkin Park", "In the end", "D#", "minor"],
  ["No doubt", "Speak", "F", "minor"],
  ["Ozone", "Dragosta", "C", "major"],
  ["PULP", "Common", "C", "major"],
  ["Pixies", "my mind", "E", "major"],
  ["Rihanna", "Umbrella", "C#", "major"],
  ["Polo & Pan", "Canopee", "F", "minor"],
];

function findAudio(artist: string, title: string): string | null {
  const root = join(SONGS, artist);
  if (!existsSync(root)) return null;
  for (const album of readdirSync(root)) {
    let titles: string[];
    try {
      titles = readdirSync(join(root, album));
    } catch {
      continue;
    }
    for (const t of titles) {
      if (!t.toLowerCase().includes(title.toLowerCase())) continue;
      const dir = join(root, album, t);
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        continue;
      }
      const m =
        files.find((f) => /^original\.(mp3|flac|wav|m4a)$/i.test(f)) ??
        files.find((f) => /\.(mp3|flac|wav|m4a)$/i.test(f));
      if (m) return join(dir, m);
    }
  }
  return null;
}

const work = mkdtempSync(join(tmpdir(), "key-truth-"));
const RATE = 22050;

function decode(src: string, i: number): Float32Array | null {
  const out = join(work, `p${i}.raw`);
  try {
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "quiet",
        "-y",
        "-i",
        src,
        "-ac",
        "1",
        "-ar",
        String(RATE),
        "-f",
        "f32le",
        out,
      ],
      { timeout: 180000 },
    );
  } catch {
    return null;
  }
  const b = readFileSync(out);
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}

// ── the variants under test ──────────────────────────────────────────────────
//
// Each takes the PER-SEMITONE energies of one frame and folds them to 12 classes. The baseline is
// what `src/key.ts` does today; the rest are the plan's ranked suspects.

const LOW = 48;
const HIGH = 96;
const FRAME = 4096;

/** Raw per-semitone energy for one frame, by Goertzel — the input every variant folds. */
function semitones(s: Float32Array, at: number, rate: number): number[] {
  const out: number[] = [];
  for (let m = LOW; m <= HIGH; m++) {
    const hz = 440 * 2 ** ((m - 69) / 12);
    const coeff = 2 * Math.cos((2 * Math.PI * hz) / rate);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = s[at + i] + coeff * s1 - s2;
      s2 = s1;
      s1 = v;
    }
    out.push(s1 * s1 + s2 * s2 - coeff * s1 * s2);
  }
  return out;
}

type Fold = (semis: number[]) => number[];

/** Today's: sum the octaves of each class, linear energy. */
const linear: Fold = (semis) => {
  const c = new Array<number>(12).fill(0);
  semis.forEach((v, i) => {
    c[(LOW + i) % 12] += v;
  });
  return c;
};

/** LOG energy: a chorus is 20 dB over a verse, and linear lets the loudest bar decide the key. */
const logFold: Fold = (semis) => {
  const c = new Array<number>(12).fill(0);
  semis.forEach((v, i) => {
    c[(LOW + i) % 12] += Math.log1p(v);
  });
  return c;
};

/** Subtract what the harmonics of LOWER notes explain — the plan's first suspect.
 *
 * A note's 3rd harmonic lands a fifth above it and its 5th a major third above, so every bass note
 * votes for chords it is not playing. This walks the semitones upward, and each time it accepts a
 * fundamental it removes that note's expected contribution higher up. */
const deharmonic =
  (fold: Fold): Fold =>
  (semis) => {
    const clean = [...semis];
    for (let i = 0; i < clean.length; i++) {
      const e = clean[i];
      if (e <= 0) continue;
      // 3rd harmonic: +19 semitones (an octave and a fifth). 5th: +28 (two octaves and a third).
      for (const [step, share] of [
        [19, 0.33],
        [28, 0.15],
        [12, 0.5],
      ] as const) {
        const at = i + step;
        if (at < clean.length) clean[at] = Math.max(0, clean[at] - e * share);
      }
    }
    return fold(clean);
  };

const VARIANTS: [string, Fold][] = [
  ["baseline (linear)", linear],
  ["log energy", logFold],
  ["harmonics removed", deharmonic(linear)],
  ["log + harmonics", deharmonic(logFold)],
];

/** A whole-file chroma for one variant. */
function chromaWith(s: Float32Array, fold: Fold): number[] {
  const chroma = new Array<number>(12).fill(0);
  const hop = FRAME >> 1;
  for (let at = 0; at + FRAME <= s.length; at += hop) {
    const f = fold(semitones(s, at, RATE));
    const total = f.reduce((a, b) => a + b, 0);
    if (!(total > 0)) continue;
    for (let c = 0; c < 12; c++) chroma[c] += f[c] / total;
  }
  const max = Math.max(...chroma);
  return max > 0 ? chroma.map((v) => v / max) : chroma;
}

// ── run ──────────────────────────────────────────────────────────────────────

console.log("decoding…");
const clips: { name: string; pcm: Float32Array; tonic: string; mode: Mode }[] =
  [];
TRUTH.forEach(([a, t, tonic, mode], i) => {
  const src = findAudio(a, t);
  if (!src) return console.log(`  ${a} / ${t}: not on this machine`);
  const pcm = decode(src, i);
  if (!pcm || pcm.length < RATE * 40)
    return console.log(`  ${a} / ${t}: undecodable`);
  const from = Math.min(Math.floor(pcm.length * 0.2), RATE * 30);
  clips.push({
    name: `${a} / ${t}`,
    pcm: pcm.subarray(from, Math.min(pcm.length, from + RATE * 120)),
    tonic,
    mode,
  });
});
console.log(`${clips.length} records\n`);

const pad = (s: string, n: number) =>
  s.length > n ? s.slice(0, n) : s.padEnd(n);
console.log(
  pad("variant", 22) + pad("profile", 12) + pad("exact", 9) + "camelot-ok",
);

for (const [vname, fold] of VARIANTS) {
  const chromas = clips.map((c) => chromaWith(c.pcm, fold));
  for (const [pname, profile] of [
    ["Temperley", TEMPERLEY],
    ["Krumhansl", KRUMHANSL],
  ] as const) {
    let ok = 0;
    let mix = 0;
    const misses: string[] = [];
    chromas.forEach((ch, i) => {
      const c = clips[i];
      const k = keyOf(ch, profile);
      const truth: DetectedKey = {
        tonic: PITCH_CLASSES.indexOf(c.tonic as (typeof PITCH_CLASSES)[number]),
        mode: c.mode,
        margin: 1,
      };
      if (k && k.tonic === truth.tonic && k.mode === c.mode) ok++;
      else misses.push(`${c.name}: ${keyName(k)} (${c.tonic} ${c.mode})`);
      if (compatible(camelot(truth), camelot(k))) mix++;
    });
    const pct = (n: number) => `${n}/${clips.length}`;
    console.log(pad(vname, 22) + pad(pname, 12) + pad(pct(ok), 9) + pct(mix));
    if (VERBOSE && pname === "Temperley")
      for (const m of misses) console.log(`      ${m}`);
  }
}

rmSync(work, { recursive: true, force: true });
