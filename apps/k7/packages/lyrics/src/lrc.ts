// lrc.ts — LRC lyrics as timed lines, and their alignment onto a song's own chord sheet.
// Pure, so the matching is tested without a player — ../../../docs/lyricsTiming.md.
// What reads wrong: an LRC timecode `[01:23.45]` looks like an inline chord or a section label,
// so timecodes are kept BESIDE the lyrics text and never written into it.

import { distance } from "fastest-levenshtein";
import { parseChordSheet } from "./chords";

/** One timed line of an LRC file. */
export interface LrcLine {
  t: number;
  text: string;
}

/** When one lyric line is sung: its line index in the lyrics, its normalised text, and seconds. */
export interface LyricTiming {
  line: number;
  text: string;
  t: number;
}

/** Two lines at least this alike are the same line, give or take a typo or a contraction. */
export const MATCH_THRESHOLD = 0.7;

/** Below this share of lines matched, the LRC is not these lyrics and is refused. */
export const MIN_FIT = 0.5;

const LEADING_STAMP = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]/im;

/** The timed lines of an LRC file, in time order; a line with several stamps is sung several times. */
export function parseLrc(source: string): LrcLine[] {
  // A positive offset makes the lyrics come sooner, in milliseconds.
  const offset = Number(OFFSET_TAG.exec(source)?.[1] ?? 0) / 1000;
  const out: LrcLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const stamps: number[] = [];
    let rest = raw;
    let m = LEADING_STAMP.exec(rest);
    while (m) {
      stamps.push(Number(m[1]) * 60 + Number(m[2].replace(":", ".")));
      rest = rest.slice(m[0].length);
      m = LEADING_STAMP.exec(rest);
    }
    const text = rest.replace(WORD_STAMP, "").trim();
    if (stamps.length === 0 || text === "") continue;
    for (const s of stamps) out.push({ t: Math.max(0, s - offset), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** A line as the matcher compares it: no accents, no case, no punctuation, single spaces. */
export function normalizeLine(line: string): string {
  return line
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The sung lines of a chord sheet — chords, section labels and blanks left out — by line index. */
export function lyricLines(lyrics: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  parseChordSheet(lyrics).forEach((parsed, line) => {
    if (parsed.type !== "lyrics") return;
    const text = normalizeLine(parsed.segments.map((s) => s.text).join(""));
    if (text !== "") out.push({ line, text });
  });
  return out;
}

/** How alike two normalised lines are, from 0 to 1. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - distance(a, b) / longest;
}

/** The pairs (i, j) that match `a[i]` with `b[j]`, in order on both sides, scoring the most similarity overall. */
export function alignLines(
  a: readonly string[],
  b: readonly string[],
  threshold: number,
): [number, number][] {
  const rows = a.length;
  const cols = b.length;
  const score = Array.from(
    { length: rows + 1 },
    () => new Float64Array(cols + 1),
  );
  const sim = Array.from({ length: rows }, () => new Float64Array(cols));
  for (let i = 1; i <= rows; i++)
    for (let j = 1; j <= cols; j++) {
      const s = similarity(a[i - 1], b[j - 1]);
      sim[i - 1][j - 1] = s;
      const pair = s >= threshold ? score[i - 1][j - 1] + s : -1;
      score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], pair);
    }
  const pairs: [number, number][] = [];
  let i = rows;
  let j = cols;
  while (i > 0 && j > 0) {
    const s = sim[i - 1][j - 1];
    if (s >= threshold && score[i][j] === score[i - 1][j - 1] + s) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (score[i][j] === score[i - 1][j]) i--;
    else j--;
  }
  return pairs.reverse();
}

export type LrcImport =
  | { ok: true; lyrics: string | null; timings: LyricTiming[]; matched: number }
  | { ok: false; reason: "empty" | "mismatch"; matched: number; total: number };

/** What an LRC file does to a song: becomes its lyrics when there are none, else times the lines it matches. */
export function importLrc(lyrics: string, source: string): LrcImport {
  const lrc = parseLrc(source).filter((l) => normalizeLine(l.text) !== "");
  if (lrc.length === 0)
    return { ok: false, reason: "empty", matched: 0, total: 0 };

  if (lyrics.trim() === "") {
    const text = lrc.map((l) => l.text).join("\n");
    const timings = lrc.map((l, line) => ({
      line,
      text: normalizeLine(l.text),
      t: l.t,
    }));
    return { ok: true, lyrics: text, timings, matched: timings.length };
  }

  const lines = lyricLines(lyrics);
  const pairs = alignLines(
    lines.map((l) => l.text),
    lrc.map((l) => normalizeLine(l.text)),
    MATCH_THRESHOLD,
  );
  const total = Math.min(lines.length, lrc.length);
  if (total === 0 || pairs.length < total * MIN_FIT)
    return { ok: false, reason: "mismatch", matched: pairs.length, total };
  const timings = pairs.map(([i, j]) => ({
    line: lines[i].line,
    text: lines[i].text,
    t: lrc[j].t,
  }));
  return { ok: true, lyrics: null, timings, matched: pairs.length };
}

/** Everything a hand needs to finish an alignment: both sides, and what paired by itself. */
export interface LrcAlignment {
  /** The file's timed lines, in time order. */
  lrc: LrcLine[];
  /** The song's sung lines, by their index in the lyrics. */
  lines: { line: number; text: string }[];
  /** Which LRC line each lyric line is on, by index into `lines` and `lrc`. */
  pairs: Map<number, number>;
  matched: number;
  total: number;
}

/** Pair an LRC with the lyrics as far as it goes, refusing nothing: what it misses is paired by hand. */
export function alignLrc(lyrics: string, source: string): LrcAlignment {
  const lrc = parseLrc(source).filter((l) => normalizeLine(l.text) !== "");
  const lines = lyricLines(lyrics);
  const pairs = new Map<number, number>(
    alignLines(
      lines.map((l) => l.text),
      lrc.map((l) => normalizeLine(l.text)),
      MATCH_THRESHOLD,
    ),
  );
  return {
    lrc,
    lines,
    pairs,
    matched: pairs.size,
    total: Math.min(lines.length, lrc.length),
  };
}

/** The timecodes a set of pairs means, in line order — what is saved once the hand is done. */
export function timingsFrom(
  lines: readonly { line: number; text: string }[],
  lrc: readonly LrcLine[],
  pairs: ReadonlyMap<number, number>,
): LyricTiming[] {
  return [...pairs.entries()]
    .filter(([i, j]) => lines[i] !== undefined && lrc[j] !== undefined)
    .map(([i, j]) => ({
      line: lines[i].line,
      text: lines[i].text,
      t: lrc[j].t,
    }))
    .sort((a, b) => a.line - b.line);
}

/** The stored timecodes laid onto the lyrics AS THEY ARE NOW: an edited line loses its time, the rest keep theirs. */
export function timingsByLine(
  lyrics: string,
  timings: readonly LyricTiming[],
): Map<number, number> {
  const lines = lyricLines(lyrics);
  const stored = [...timings].sort((a, b) => a.line - b.line);
  const pairs = alignLines(
    lines.map((l) => l.text),
    stored.map((s) => s.text),
    1,
  );
  return new Map(pairs.map(([i, j]) => [lines[i].line, stored[j].t]));
}

/** The line being sung at `seconds`: the last one whose time has come, or null before the first. */
export function lineAt(
  byLine: ReadonlyMap<number, number>,
  seconds: number,
): number | null {
  let best: number | null = null;
  let bestT = -1;
  for (const [line, t] of byLine)
    if (t <= seconds && t >= bestT) {
      best = line;
      bestT = t;
    }
  return best;
}
