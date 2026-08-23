// Maps a chord symbol (e.g. "C#m7", "G/B") to guitar fingering positions from
// @tombatossals/chords-db. This is the only module that touches the database, so
// the rest of the app stays decoupled from its shape.

import { splitChord } from "@k7/lyrics";
import guitarData from "@tombatossals/chords-db/lib/guitar.json";
import type {
  ChordInstrument,
  ChordPosition,
  DbChord,
  GuitarDb,
} from "../types/chords";

// A cast, because resolveJsonModule infers no index signature — ../../../docs/tablature.md.
const guitar = guitarData as unknown as GuitarDb;

/** Instrument config consumed by @tombatossals/react-chords. */
export const GUITAR: ChordInstrument = {
  strings: guitar.main.strings,
  fretsOnChord: guitar.main.fretsOnChord,
  name: guitar.main.name,
  keys: guitar.keys,
  tunings: guitar.tunings,
};

// Root note to the chords-db property name: sharps camelCased, enharmonics folded in.
const ROOT_TO_DB: Record<string, string> = {
  C: "C",
  "C#": "Csharp",
  Db: "Csharp",
  "B#": "C",
  D: "D",
  "D#": "Eb",
  Eb: "Eb",
  E: "E",
  Fb: "E",
  F: "F",
  "E#": "F",
  "F#": "Fsharp",
  Gb: "Fsharp",
  G: "G",
  "G#": "Ab",
  Ab: "Ab",
  A: "A",
  "A#": "Bb",
  Bb: "Bb",
  B: "B",
  Cb: "B",
};

// Parsed chord quality -> chords-db `suffix` vocabulary.
const SUFFIX_ALIASES: Record<string, string> = {
  "": "major",
  maj: "major",
  M: "major",
  m: "minor",
  min: "minor",
  "-": "minor",
  dim: "dim",
  dim7: "dim7",
  "°": "dim",
  "°7": "dim7",
  aug: "aug",
  "+": "aug",
  sus: "sus4",
  sus2: "sus2",
  sus4: "sus4",
  "6": "6",
  m6: "m6",
  "69": "69",
  "7": "7",
  "7sus4": "7sus4",
  maj7: "maj7",
  M7: "maj7",
  m7: "m7",
  m7b5: "m7b5",
  ø: "m7b5",
  "9": "9",
  maj9: "maj9",
  m9: "m9",
  add9: "add9",
  madd9: "madd9",
  "11": "11",
  m11: "m11",
  "13": "13",
  m13: "m13",
  maj13: "maj13",
  "7b5": "7b5",
  "7b9": "7b9",
  "7#9": "7#9",
  mmaj7: "mmaj7",
};

const norm = (s: string) => s.replace(/♯/g, "#").replace(/♭/g, "b");

/** Fingerings for a chord symbol — exact quality, then slash, then bare triad — or null. */
export function getChordPositions(symbol: string): ChordPosition[] | null {
  const parts = splitChord(symbol);
  if (!parts) return null;

  const key = ROOT_TO_DB[norm(parts.root)];
  if (!key) return null;
  const entries: DbChord[] = guitar.chords[key] ?? [];
  if (entries.length === 0) return null;

  const dbSuffix = SUFFIX_ALIASES[norm(parts.suffix)] ?? norm(parts.suffix);
  const isMinor = /^m(?!aj)/.test(dbSuffix);
  const find = (suf: string) => entries.find((c) => c.suffix === suf);

  let match: DbChord | undefined;
  // chords-db encodes slash chords as suffixes like "/E" (major) or "m/B" (minor).
  if (parts.bass) match = find(`${isMinor ? "m" : ""}/${norm(parts.bass)}`);
  match = match ?? find(dbSuffix);
  // Fall back to the bare triad so unusual extensions still show a usable shape.
  if (!match) match = find(isMinor ? "minor" : "major");

  return match ? match.positions : null;
}
