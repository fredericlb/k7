// The random-chord exercise: pick a chord for the player to fret. Roots and
// qualities are all present in @tombatossals/chords-db, so the "reveal"
// fingering diagram is always available.

export const EXERCISE_ROOTS = [
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

// A quality: the suffix appended to the root, plus a human label.
export const EXERCISE_QUALITIES: { suffix: string; label: string }[] = [
  { suffix: "", label: "major" },
  { suffix: "m", label: "minor" },
  { suffix: "7", label: "dominant 7th" },
  { suffix: "maj7", label: "major 7th" },
  { suffix: "m7", label: "minor 7th" },
  { suffix: "6", label: "sixth" },
  { suffix: "m6", label: "minor sixth" },
  { suffix: "dim", label: "diminished" },
  { suffix: "aug", label: "augmented" },
  { suffix: "sus2", label: "suspended 2nd" },
  { suffix: "sus4", label: "suspended 4th" },
  { suffix: "9", label: "ninth" },
  { suffix: "add9", label: "added 9th" },
  { suffix: "m7b5", label: "half-diminished" },
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
    if (symbol !== avoid) return { symbol, quality: q.label };
  }
  const root = pick(EXERCISE_ROOTS);
  const q = pick(EXERCISE_QUALITIES);
  return { symbol: root + q.suffix, quality: q.label };
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
