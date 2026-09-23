// lrc.ts — LRC lyrics as timed lines, and their timecodes written into a song's own sheet as
// `{{MM:SS}}`. Pure, so the matching is tested without a player — ../../../docs/lyricsTiming.md.
// What reads wrong: an LRC's own `[01:23.45]` looks like an inline chord or a section label, which
// is why the text gets `{{MM:SS}}` instead — a spelling nothing else in a sheet uses.

import { distance } from "fastest-levenshtein";
import {
  formatTimecode,
  isTabLine,
  looseChordLine,
  parseChordSheet,
  stripTimecodes,
  timecodeOf,
} from "./chords";

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

/** A sheet line at least this close to a fetched line is where its timecode goes; below, it gets none. */
export const TIMECODE_THRESHOLD = 0.5;

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

/** The sung lines of a chord sheet — chords (`C**` too), tablature, section labels and blanks left out — by line index. */
export function lyricLines(lyrics: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const raw = lyrics.split(/\r?\n/);
  parseChordSheet(lyrics).forEach((parsed, line) => {
    if (parsed.type !== "lyrics") return;
    const bare = stripTimecodes(raw[line] ?? "");
    if (isTabLine(bare) || looseChordLine(bare)) return;
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

/**
 * A pairing of the sheet's lyric lines with the fetched ones that allows for different LINE BREAKS:
 * one sheet line may be two fetched lines ("…angry heart, filled with cancers…" split in two), or two
 * sheet lines one fetched line ("…get out of" / "bed in the morning" joined). `i`/`ni` and `j`/`nj`
 * are where each side's run starts and how many lines it takes. A span's time is its first fetched
 * line's, and it goes on its first sheet line — where the singing of it starts.
 */
export interface Span {
  i: number;
  ni: 1 | 2;
  j: number;
  nj: 1 | 2;
}

/**
 * The spans, in order on both sides, scoring the most similarity weighted by how many lines each
 * covers. A two-line span must match BETTER than either of its lines alone — else it is one line and
 * some noise — and `joinable[i]` says whether sheet lines i and i+1 may be one line at all (nothing
 * stood between them on the sheet).
 */
export function alignSpans(
  a: readonly string[],
  b: readonly string[],
  threshold: number,
  joinable: readonly boolean[] = [],
): Span[] {
  const joined = (xs: readonly string[], ok: (k: number) => boolean) =>
    xs.map((x, k) => (k + 1 < xs.length && ok(k) ? `${x} ${xs[k + 1]}` : ""));
  const a2 = joined(a, (k) => joinable[k] ?? true);
  const b2 = joined(b, () => true);
  const text = (
    xs: readonly string[],
    xs2: readonly string[],
    k: number,
    n: 1 | 2,
  ) => (n === 1 ? xs[k] : xs2[k]);
  const rows = a.length;
  const cols = b.length;
  const score = Array.from(
    { length: rows + 1 },
    () => new Float64Array(cols + 1),
  );
  const step: (Span | "up" | "left" | null)[][] = Array.from(
    { length: rows + 1 },
    () => new Array(cols + 1).fill(null),
  );
  const SHAPES: [1 | 2, 1 | 2][] = [
    [1, 1],
    [1, 2],
    [2, 1],
  ];
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= cols; j++) {
      if (i === 0 && j === 0) continue;
      let best = Number.NEGATIVE_INFINITY;
      let pick: Span | "up" | "left" | null = null;
      if (i > 0 && score[i - 1][j] > best) {
        best = score[i - 1][j];
        pick = "up";
      }
      if (j > 0 && score[i][j - 1] > best) {
        best = score[i][j - 1];
        pick = "left";
      }
      for (const [ni, nj] of SHAPES) {
        if (i < ni || j < nj) continue;
        const left = text(a, a2, i - ni, ni);
        const right = text(b, b2, j - nj, nj);
        if (!left || !right) continue;
        const s = similarity(left, right);
        if (s < threshold) continue;
        if (ni + nj > 2) {
          // The better of its lines alone: joining has to beat it, or the extra line is noise.
          const alone =
            ni === 2
              ? Math.max(
                  similarity(a[i - 2], b[j - 1]),
                  similarity(a[i - 1], b[j - 1]),
                )
              : Math.max(
                  similarity(a[i - 1], b[j - 2]),
                  similarity(a[i - 1], b[j - 1]),
                );
          if (s <= alone) continue;
        }
        // Weighted by the lines it covers, so a split that explains both halves beats half of it.
        const v = score[i - ni][j - nj] + (s * (ni + nj)) / 2;
        if (v > best) {
          best = v;
          pick = { i: i - ni, ni, j: j - nj, nj };
        }
      }
      score[i][j] = best;
      step[i][j] = pick;
    }
  const spans: Span[] = [];
  let i = rows;
  let j = cols;
  while (i > 0 || j > 0) {
    const s = step[i][j];
    if (s === "up") i--;
    else if (s === "left") j--;
    else if (s) {
      spans.push(s);
      i = s.i;
      j = s.j;
    } else break;
  }
  return spans.reverse();
}

export type LrcTimecoding =
  | {
      ok: true;
      /** The sheet with `{{MM:SS}}` at the end of each line a fetched line found — nothing else changed. */
      lyrics: string;
      /** Fetched lines that found a sheet line, out of all of them. */
      placed: number;
      total: number;
    }
  | { ok: false; reason: "empty" };

/**
 * What an LRC does to a song: it TIMES the lyrics, and nothing more. Each fetched line finds the sheet
 * line closest to it — chords, tablature, sections and blanks never — in order on both sides, so the
 * third fetched line can never land above the second's; its time goes at the end of that line as
 * `{{MM:SS}}`, where it shifts no chord off the word it is over. Line breaks may differ (`alignSpans`):
 * a sheet line the LRC sings as two gets the first one's time, two sheet lines it sings as one give
 * it to the first. Codes already there are replaced. A song with no lyrics gets the fetched lines
 * themselves, each with its code.
 */
export function timeLyrics(lyrics: string, source: string): LrcTimecoding {
  const lrc = parseLrc(source).filter((l) => normalizeLine(l.text) !== "");
  if (lrc.length === 0) return { ok: false, reason: "empty" };

  if (lyrics.trim() === "")
    return {
      ok: true,
      lyrics: lrc.map((l) => `${l.text} ${formatTimecode(l.t)}`).join("\n"),
      placed: lrc.length,
      total: lrc.length,
    };

  const raw = lyrics
    .split(/\r?\n/)
    .map((line) => (timecodeOf(line) === null ? line : stripTimecodes(line)));
  const lines = lyricLines(raw.join("\n"));
  // Two sheet lines may be sung as one only when nothing but chords stands between them.
  const parsed = parseChordSheet(raw.join("\n"));
  const joinable = lines.map((l, k) => {
    const next = lines[k + 1];
    if (!next) return false;
    for (let at = l.line + 1; at < next.line; at++)
      if (parsed[at].type !== "chords" && !looseChordLine(raw[at]))
        return false;
    return true;
  });
  const spans = alignSpans(
    lines.map((l) => l.text),
    lrc.map((l) => normalizeLine(l.text)),
    TIMECODE_THRESHOLD,
    joinable,
  );
  for (const sp of spans) {
    const at = lines[sp.i].line;
    raw[at] = `${raw[at].replace(/\s+$/, "")} ${formatTimecode(lrc[sp.j].t)}`;
  }
  return {
    ok: true,
    lyrics: raw.join("\n"),
    placed: spans.reduce((n, sp) => n + sp.nj, 0),
    total: lrc.length,
  };
}

/** Each timed line's start, by line index, read off the `{{MM:SS}}` in the text — what the player follows. */
export function timecodesByLine(lyrics: string): Map<number, number> {
  const out = new Map<number, number>();
  lyrics.split(/\r?\n/).forEach((line, i) => {
    const t = timecodeOf(line);
    if (t !== null) out.set(i, t);
  });
  return out;
}

/** Whether the text carries any timecode at all. */
export const hasTimecodes = (lyrics: string): boolean =>
  timecodesByLine(lyrics).size > 0;

/** Timecodes stored BESIDE the text, as songs timed before `{{MM:SS}}` have them, laid onto the lyrics as they are now: an edited line loses its time, the rest keep theirs. */
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
