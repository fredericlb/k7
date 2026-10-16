// The random-chord exercise: pick a chord for the player to fret. Roots and
// qualities are all present in @tombatossals/chords-db, so the "reveal"
// fingering diagram is always available.

const EXERCISE_ROOTS = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

import { m } from "../paraglide/messages.js";

// A quality: the suffix appended to the root, plus its name in the language shown.
const EXERCISE_QUALITIES: { suffix: string; label: () => string }[] = [
  { suffix: "", label: m["chord.major"] },
  { suffix: "m", label: m["chord.minor"] },
  { suffix: "7", label: m["chord.dominant7"] },
  { suffix: "maj7", label: m["chord.major7"] },
  { suffix: "m7", label: m["chord.minor7"] },
  { suffix: "6", label: m["chord.sixth"] },
  { suffix: "m6", label: m["chord.minorSixth"] },
  { suffix: "dim", label: m["chord.diminished"] },
  { suffix: "aug", label: m["chord.augmented"] },
  { suffix: "sus2", label: m["chord.sus2"] },
  { suffix: "sus4", label: m["chord.sus4"] },
  { suffix: "9", label: m["chord.ninth"] },
  { suffix: "add9", label: m["chord.add9"] },
  { suffix: "m7b5", label: m["chord.halfDiminished"] },
];

export interface ChordPrompt {
  symbol: string; // e.g. "F#m7"
  quality: string; // e.g. "minor 7th"
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** A random chord prompt, never equal to `avoid` (the current one). */
export function randomChord(avoid?: string): ChordPrompt {
  // A few retries keep the same chord from coming up twice; the pool converges at once.
  for (let i = 0; i < 20; i++) {
    const root = pick(EXERCISE_ROOTS);
    const q = pick(EXERCISE_QUALITIES);
    const symbol = root + q.suffix;
    if (symbol !== avoid) return { symbol, quality: q.label() };
  }
  const root = pick(EXERCISE_ROOTS);
  const q = pick(EXERCISE_QUALITIES);
  return { symbol: root + q.suffix, quality: q.label() };
}

/** `size` DIFFERENT items of `pool`, in random order — fewer when the pool holds fewer. */
export function pickWorkout<T>(pool: readonly T[], size = 3): T[] {
  const rest = [...pool];
  const out: T[] = [];
  // Drawn without replacement: the same exercise twice is not a workout, it is a repeat.
  while (out.length < size && rest.length)
    out.push(...rest.splice(Math.floor(Math.random() * rest.length), 1));
  return out;
}
