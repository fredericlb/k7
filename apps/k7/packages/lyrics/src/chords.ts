// Client-side parser + transposer for song lyrics that mix two chord-sheet
// styles: "chords above lyrics" (a monospace-aligned line of chords sitting on
// top of the lyric line) and inline bracketed chords such as `[C]` / `(Am)`.
//
// Everything here is pure and framework-free so it can be unit-tested and reused
// by the ChordSheet renderer. Lyrics stay plain strings in storage; parsing only
// happens on display.

// ---- Chord recognition ----------------------------------------------------

// A single note: root letter, optional accidental.
const NOTE = "[A-G](?:#|b|♯|♭)?";

// A KNOWN vocabulary, not "any letters", so "Bad" is not a chord — ../../../docs/tablature.md.
const QUALITY = "(?:maj|min|aug|dim|sus|add|m|M|Δ|°|ø|\\+|-)";
const EXT = "(?:[0-9]|[#b][0-9]|\\([^)]*\\))";
const CHORD_BODY = `${QUALITY}?${EXT}*`;

const CHORD_RE = new RegExp(`^${NOTE}(?:${CHORD_BODY})(?:/${NOTE})?$`);

// Tokens that legitimately appear on a chord line without being a chord.
const CHORD_LINE_EXTRA = /^(?:\||\|\||:\||\|:|x\d+|\d+x|N\.?C\.?|-|—)$/i;

/** True if `token` looks like a standalone chord symbol (e.g. `C#m7`, `G/B`). */
export function isChord(token: string): boolean {
  if (!token) return false;
  if (/^N\.?C\.?$/i.test(token)) return true; // "no chord" marker
  return CHORD_RE.test(token);
}

// ---- Transposition --------------------------------------------------------

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const BASE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function noteToIndex(note: string): number | null {
  const m = /^([A-G])(#|b|♯|♭)?/.exec(note);
  if (!m) return null;
  let idx = BASE[m[1]];
  if (m[2] === "#" || m[2] === "♯") idx += 1;
  else if (m[2] === "b" || m[2] === "♭") idx -= 1;
  return ((idx % 12) + 12) % 12;
}

function transposeNote(
  note: string,
  semitones: number,
  preferFlats: boolean,
): string {
  const idx = noteToIndex(note);
  if (idx === null) return note;
  const next = (((idx + semitones) % 12) + 12) % 12;
  return (preferFlats ? FLAT : SHARP)[next];
}

/** Transpose one chord: only the root and any slash bass move, and a non-chord does not. */
export function transposeChord(
  chord: string,
  semitones: number,
  preferFlats?: boolean,
): string {
  if (!semitones || !isChord(chord)) return chord;
  const flats = preferFlats ?? /b|♭/.test(chord);
  // Split off the slash-bass so root and bass move independently.
  const slash = chord.indexOf("/");
  const head = slash === -1 ? chord : chord.slice(0, slash);
  const bass = slash === -1 ? "" : chord.slice(slash + 1);

  const rootMatch = /^([A-G](?:#|b|♯|♭)?)(.*)$/.exec(head);
  if (!rootMatch) return chord;
  const newRoot = transposeNote(rootMatch[1], semitones, flats) + rootMatch[2];
  if (!bass) return newRoot;
  return `${newRoot}/${transposeNote(bass, semitones, flats)}`;
}

/** Every chord on a line, keeping the exact whitespace between tokens (../../../docs/tablature.md). */
export function transposeLine(line: string, semitones: number): string {
  if (!semitones) return line;
  return line
    .split(/(\s+)/)
    .map((tok) => (/^\s+$/.test(tok) ? tok : transposeChord(tok, semitones)))
    .join("");
}

/** Split a chord symbol into root note, quality suffix, and optional slash-bass. */
export function splitChord(
  symbol: string,
): { root: string; suffix: string; bass: string | null } | null {
  if (!isChord(symbol)) return null;
  const slash = symbol.indexOf("/");
  const head = slash === -1 ? symbol : symbol.slice(0, slash);
  const bass = slash === -1 ? null : symbol.slice(slash + 1);
  const m = /^([A-G](?:#|b|♯|♭)?)(.*)$/.exec(head);
  if (!m) return null;
  return { root: m[1], suffix: m[2], bass };
}

// ---- Timecodes ------------------------------------------------------------

/** A line's time, written in the text as `{{MM:SS}}` — by the LRC import, or by hand. See ../../../docs/lyricsTiming.md. */
export const TIMECODE = /\{\{\s*(\d{1,3}):([0-5]\d)\s*\}\}/g;

/** The line without its timecodes — what every reader but the player sees. */
export function stripTimecodes(line: string): string {
  return line.replace(TIMECODE, "").replace(/\s+$/, "");
}

/** The first timecode on a line, in seconds, or null. */
export function timecodeOf(line: string): number | null {
  TIMECODE.lastIndex = 0;
  const m = TIMECODE.exec(line);
  TIMECODE.lastIndex = 0;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `{{MM:SS}}` for a time in seconds, the seconds rounded down. */
export function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `{{${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}}}`;
}

// ---- Tablature, and chords as a hand types them ----------------------------

/** A line of tablature: a string's name or a bar, then fret numbers and techniques over dashes. */
const TAB_LINE = /^[\sA-Ga-g#b|:\-–—0-9hpbrstx/\\~().^*=]+$/;
export function isTabLine(line: string): boolean {
  const t = line.trim();
  return (
    t.length >= 6 &&
    t.includes("|") &&
    (t.match(/-/g)?.length ?? 0) >= 3 &&
    TAB_LINE.test(t)
  );
}

/** A chord as a hand writes it on a sheet — `C**`, `G.` — its trailing marks being emphasis, not harmony. */
const chordish = (tok: string) => isChord(tok.replace(/[*~.!,']+$/, ""));

/** Looser than the renderer's test, for the sheets people actually type: `C**` is a chord line. */
export function looseChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  let saw = false;
  for (const tok of tokens) {
    if (chordish(tok)) saw = true;
    else if (!CHORD_LINE_EXTRA.test(tok) && tok !== "/") return false;
  }
  return saw;
}

// ---- Line parsing ---------------------------------------------------------

export interface Segment {
  chord: string | null;
  text: string;
}

export type ParsedLine =
  | { type: "empty" }
  | { type: "section"; label: string }
  | { type: "chords"; text: string }
  | { type: "lyrics"; segments: Segment[] };

// A whole-line section label: [Verse 1], (Chorus), {Bridge} or "Chorus:".
const BRACKET_SECTION = /^\s*[[({]\s*([^\])}]+?)\s*[\])}]\s*$/;
const COLON_SECTION = /^\s*([A-Za-z][\w '#/-]*?):\s*$/;

// Inline chord token inside a lyric line: [C] or (Am).
const INLINE_CHORD = /[[(]([^\])]+)[\])]/g;

function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === "") return false;
  let sawChord = false;
  for (const tok of tokens) {
    if (isChord(tok)) sawChord = true;
    else if (!CHORD_LINE_EXTRA.test(tok)) return false;
  }
  return sawChord;
}

function parseLyricLine(line: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let pending: string | null = null;
  let m: RegExpExecArray | null;
  INLINE_CHORD.lastIndex = 0;
  while ((m = INLINE_CHORD.exec(line)) !== null) {
    if (!isChord(m[1])) continue; // e.g. "[x2]" or "(oh yeah)" stay literal
    const before = line.slice(lastIndex, m.index);
    if (pending === null && before === "") {
      // leading chord with nothing before it — nothing to flush
    } else {
      segments.push({ chord: pending, text: before });
    }
    pending = m[1];
    lastIndex = m.index + m[0].length;
  }
  const tail = line.slice(lastIndex);
  if (pending !== null || tail !== "")
    segments.push({ chord: pending, text: tail });
  if (segments.length === 0) segments.push({ chord: null, text: line });
  return segments;
}

/** Split raw lyric text into classified lines for rendering. */
export function parseChordSheet(text: string): ParsedLine[] {
  return text.split(/\r?\n/).map((raw): ParsedLine => {
    // Manual override markers, mirroring obsidian-chord-sheets (%c / %t). A timecode is not text.
    let line = stripTimecodes(raw);
    let force: "chords" | "lyrics" | null = null;
    const marker = /\s*%([ct])\s*$/.exec(line);
    if (marker) {
      force = marker[1] === "c" ? "chords" : "lyrics";
      line = line.slice(0, marker.index);
    }

    if (line.trim() === "") return { type: "empty" };

    if (force !== "chords") {
      const bracket = BRACKET_SECTION.exec(line);
      if (bracket && !isChord(bracket[1]))
        return { type: "section", label: bracket[1] };
      const colon = COLON_SECTION.exec(line);
      if (colon && !isChordLine(line))
        return { type: "section", label: colon[1] };
    }

    if (force === "lyrics")
      return { type: "lyrics", segments: parseLyricLine(line) };
    if (force === "chords" || isChordLine(line))
      return { type: "chords", text: line };

    return { type: "lyrics", segments: parseLyricLine(line) };
  });
}

/** Every distinct chord symbol used in the text, in first-seen order. */
export function collectChords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  };
  for (const line of parseChordSheet(text)) {
    if (line.type === "chords") {
      for (const tok of line.text.trim().split(/\s+/))
        if (isChord(tok)) add(tok);
    } else if (line.type === "lyrics") {
      for (const seg of line.segments) if (seg.chord) add(seg.chord);
    }
  }
  return out;
}
