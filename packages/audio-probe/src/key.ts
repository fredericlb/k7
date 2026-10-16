// key.ts — what KEY a record is in, from decoded audio. The reference implementation, the way
// `detectTransients` (waveform.ts) is: the C++ pass mirrors this one, and the tests here are what
// says whether either is right.
//
// samples -> CHROMAGRAM -> KEY (the profile is the only taste) -> CAMELOT, by Goertzel rather than
// an FFT. Why each, and the plan it serves: ../docs/key.md.

/** The twelve, C first — the order every profile and every chroma vector below is written in. */
export const PITCH_CLASSES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export type Mode = "major" | "minor";

/** A key, as the desk would say it: `A#` + `minor`, and how far ahead of the runner-up it was. */
export interface DetectedKey {
  /** 0..11, C = 0. */
  tonic: number;
  mode: Mode;
  /** The winner's correlation minus the best of the OTHER 23, 0..2. Small means "do not trust me". */
  margin: number;
}

/** Krumhansl-Schmuckler's probe-tone profiles — the ones every textbook quotes. */
export const KRUMHANSL: Record<Mode, readonly number[]> = {
  major: [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
  ],
  minor: [
    6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
  ],
};

/** …and Temperley's, derived from a corpus rather than from listeners rating a probe tone. */
export const TEMPERLEY: Record<Mode, readonly number[]> = {
  major: [
    0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057,
    0.4,
  ],
  minor: [
    0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133,
    0.33,
  ],
};

/** C3..C7, the semitones the chromagram listens to as MIDI notes: the bottom is a RESOLUTION limit, ../docs/key.md. */
const LOW_MIDI = 48;
const HIGH_MIDI = 96;

/** Hz of a MIDI note — A4 = 440, the only tuning assumption in this file. */
const hzOf = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** One Goertzel magnitude: how much of `hz` is in this frame. Square-law, so it is energy. */
function goertzel(
  samples: Float32Array,
  from: number,
  length: number,
  hz: number,
  sampleRate: number,
): number {
  const coeff = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  // The standard two-tap recurrence, written out plainly so the C++ port has no room to differ.
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < length; i++) {
    const s = samples[from + i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/** How long a frame lasts, in SECONDS and never in samples, so the resolution holds at any rate — ../docs/key.md. */
export const FRAME_SECONDS = 0.19;

/** The frame in samples for this rate: the next power of two, so a future FFT port drops straight in. */
export function frameFor(sampleRate: number): number {
  const want = Math.max(1, sampleRate * FRAME_SECONDS);
  return 2 ** Math.ceil(Math.log2(want));
}

/** How much of each pitch class the file holds, normalised per FRAME so a loud chorus cannot outvote a verse. */
export function chromagram(
  samples: Float32Array,
  sampleRate: number,
): number[] {
  const chroma = new Array<number>(12).fill(0);
  if (!(sampleRate > 0)) return chroma;
  const frame = frameFor(sampleRate);
  const hop = frame >> 1;
  if (samples.length < frame) return chroma;

  // The frequencies are the same for every frame, so they are computed once.
  const notes: { hz: number; cls: number }[] = [];
  for (let m = LOW_MIDI; m <= HIGH_MIDI; m++)
    notes.push({ hz: hzOf(m), cls: m % 12 });

  const bins = new Array<number>(12);
  for (let at = 0; at + frame <= samples.length; at += hop) {
    bins.fill(0);
    for (const n of notes)
      bins[n.cls] += goertzel(samples, at, frame, n.hz, sampleRate);
    // A frame with nothing in it (silence between tracks) must not vote at all.
    const total = bins.reduce((a, b) => a + b, 0);
    if (!(total > 0)) continue;
    for (let c = 0; c < 12; c++) chroma[c] += bins[c] / total;
  }
  const max = Math.max(...chroma);
  return max > 0 ? chroma.map((v) => v / max) : chroma;
}

/** Pearson correlation of two 12-vectors — what "fits this profile" means here. */
function correlate(a: readonly number[], b: readonly number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / 12;
  const mb = b.reduce((x, y) => x + y, 0) / 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

/** The best of the twenty-four, and its MARGIN over the second best — what a doubt is drawn from; ../docs/key.md. */
export function keyOf(
  chroma: readonly number[],
  profile: Record<Mode, readonly number[]> = TEMPERLEY,
): DetectedKey | null {
  if (chroma.length !== 12 || !chroma.some((v) => v > 0)) return null;
  const scores: { tonic: number; mode: Mode; score: number }[] = [];
  for (const mode of ["major", "minor"] as const)
    for (let tonic = 0; tonic < 12; tonic++) {
      // Rotate the CHROMA down rather than the profile up: same answer, and the profiles stay "the degrees of C".
      const rotated = Array.from(
        { length: 12 },
        (_, i) => chroma[(i + tonic) % 12],
      );
      scores.push({ tonic, mode, score: correlate(rotated, profile[mode]) });
    }
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  return {
    tonic: best.tonic,
    mode: best.mode,
    margin: best.score - second.score,
  };
}

/** Where a key sits on the Camelot wheel: `8B` for C major, `8A` for A minor. */
export function camelot(key: DetectedKey | null): string {
  if (!key) return "";
  // The wheel walks in fifths, so the hour is the tonic's position in the circle of fifths.
  const FIFTHS_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
  const FIFTHS_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  const hour =
    key.mode === "major" ? FIFTHS_MAJOR[key.tonic] : FIFTHS_MINOR[key.tonic];
  return `${hour}${key.mode === "major" ? "B" : "A"}`;
}

/** Do these two mix? Same code, its neighbours on the wheel, or its relative major/minor. */
export function compatible(a: string, b: string): boolean {
  const parse = (s: string) => {
    const m = /^(\d{1,2})([AB])$/.exec(s);
    return m ? { hour: Number(m[1]), letter: m[2] } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  if (x.letter === y.letter) {
    // ±1 hour, and the wheel wraps: 12 and 1 are neighbours.
    const d = Math.abs(x.hour - y.hour);
    return d === 0 || d === 1 || d === 11;
  }
  // The other letter only works at the SAME hour — the relative major/minor.
  return x.hour === y.hour;
}

/** How the desk would write it: `A# mineur`. Empty for nothing detected. */
export function keyName(key: DetectedKey | null): string {
  return key
    ? `${PITCH_CLASSES[key.tonic]} ${key.mode === "major" ? "majeur" : "mineur"}`
    : "";
}
