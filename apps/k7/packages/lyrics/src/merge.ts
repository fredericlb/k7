// merge.ts — an LRC merged INTO a song's own sheet, the fetched lyrics being the source of truth.
// Pure, so it is tested line by line — ../../../docs/lyricsTiming.md.
//
// The fetched lines become the song's lyric lines, in their order and each with its time. What the
// sheet had around its own lyrics is carried over onto them: chords are moved onto the fetched words
// they were over and drawn the standard way (a line of chords above the lyric); a section label, a
// line of chords alone and a block of tablature move with the lyric line they stood before; anything
// else — a capo note, a credit — is kept under [OTHER CONTENT] at the end rather than dropped. A sheet
// that was nothing but lyrics is simply replaced.

import { isChord, parseChordSheet } from "./chords";
import {
  alignLines,
  type LyricTiming,
  type LrcLine,
  normalizeLine,
  parseLrc,
  similarity,
} from "./lrc";

/** Two lyric lines this alike are the same line sung — lower than the timing threshold, since here the time comes from the LRC anyway and a pair only decides where the chords go. */
export const MERGE_THRESHOLD = 0.5;

/** An unmatched line at least this close to some fetched line is a VARIANT of the lyrics it replaces, not other content. */
const VARIANT = 0.35;

/** Two fetched lines this alike are the same line sung again — a chorus the sheet wrote once — and get the same chords. */
const REPEAT = 0.9;

/** Words this alike are the same word, for moving a chord from the sheet's text onto the fetched one. */
const SAME_WORD = 0.75;

/** The section everything that found no place goes under, at the end of the document. */
export const OTHER_SECTION = "[OTHER CONTENT]";

/** A chord and the column it starts at, over the lyric line it belongs to. */
interface Placed {
  col: number;
  text: string;
}

type Kind = "blank" | "section" | "chords" | "tab" | "lyric";

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

/** Tokens a chord line carries besides chords: bars, repeats, "no chord". */
const CHORD_LINE_EXTRA = /^(?:\||\|\||:\||\|:|x\d+|\d+x|N\.?C\.?|-|—|\/)$/i;

/** A chord as a hand writes it on a sheet — `C**`, `G.` — its trailing marks being emphasis, not harmony. */
const chordish = (tok: string) => isChord(tok.replace(/[*~.!,']+$/, ""));

/** Looser than the renderer's test, for the sheets people actually type: `C**` is a chord line. */
function looseChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  let saw = false;
  for (const tok of tokens) {
    if (chordish(tok)) saw = true;
    else if (!CHORD_LINE_EXTRA.test(tok)) return false;
  }
  return saw;
}

/** Every token of a chord line, at the column it starts. */
function chordTokens(line: string): Placed[] {
  return [...line.matchAll(/\S+/g)].map((m) => ({
    col: m.index ?? 0,
    text: m[0],
  }));
}

/** A line of chords drawn from placed tokens — never two touching, a later one shifted right if it must. */
export function renderChordLine(placed: readonly Placed[]): string {
  let out = "";
  for (const p of [...placed].sort((a, b) => a.col - b.col)) {
    const col = out.length === 0 ? p.col : Math.max(p.col, out.length + 1);
    out = out.padEnd(col) + p.text;
  }
  return out;
}

const words = (s: string) =>
  [...s.matchAll(/\S+/g)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    key: normalizeLine(m[0]),
  }));

/** Move chords from over `from` to over `to`: by the word each sat on when that word is still there, else by where along the line it was. */
export function moveChords(
  from: string,
  to: string,
  placed: readonly Placed[],
): Placed[] {
  const a = words(from);
  const b = words(to);
  const same = new Map(
    alignLines(
      a.map((w) => w.key),
      b.map((w) => w.key),
      SAME_WORD,
    ),
  );
  return placed.map((p) => {
    // Past the end of the line: kept that far past the end of the new one.
    if (p.col >= from.length)
      return { ...p, col: to.length + (p.col - from.length) };
    // The word it sat on or just after, and how far into it.
    let w = -1;
    for (let i = 0; i < a.length && a[i].start <= p.col; i++) w = i;
    const onto = w >= 0 ? same.get(w) : undefined;
    if (w >= 0 && onto !== undefined) {
      const into = p.col - a[w].start;
      const width = b[onto].end - b[onto].start;
      return { ...p, col: b[onto].start + Math.min(into, width) };
    }
    // Its word is not there any more: the same share of the way along.
    const share = from.length ? p.col / from.length : 0;
    return { ...p, col: Math.round(share * to.length) };
  });
}

/**
 * A pairing of the sheet's lyric lines with the fetched ones that allows for different LINE BREAKS:
 * one sheet line may be two fetched lines ("…angry heart, filled with cancers…" split in two), or two
 * sheet lines one fetched line ("…get out of" / "bed in the morning" joined). `i`/`ni` and `j`/`nj`
 * are where each side's run starts and how many lines it takes.
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

/** Something the sheet had besides its lyrics, moved as one piece. */
interface Floating {
  lines: string[];
  kind: Kind;
}

/** What a merge did, for the screen that shows it before anything is saved. */
export interface MergeReport {
  /** The sheet was only lyrics, so the fetched ones replaced it outright. */
  replaced: boolean;
  /** The sheet's lyric lines found among the fetched ones, out of the smaller count. */
  matched: number;
  total: number;
  /** Fetched lines that now carry chords. */
  chords: number;
  /** Section labels, chord-only lines and tablature blocks moved along with the lyrics. */
  moved: number;
  /** Lines that found no place, under [OTHER CONTENT]. */
  other: number;
}

export type LrcMerge =
  | { ok: true; lyrics: string; timings: LyricTiming[]; report: MergeReport }
  | { ok: false; reason: "empty" };

/** Merge an LRC into `lyrics` — see the head of this file for what goes where. */
export function mergeLrc(lyrics: string, source: string): LrcMerge {
  const lrc: LrcLine[] = parseLrc(source).filter(
    (l) => normalizeLine(l.text) !== "",
  );
  if (lrc.length === 0) return { ok: false, reason: "empty" };

  const raw = lyrics.split(/\r?\n/);
  const parsed = parseChordSheet(lyrics);
  const kinds: Kind[] = raw.map((line, i) => {
    const p = parsed[i];
    if (p.type === "empty") return "blank";
    if (isTabLine(line)) return "tab";
    if (p.type === "section") return "section";
    if (p.type === "chords" || looseChordLine(line)) return "chords";
    return "lyric";
  });
  const inline = parsed.some(
    (p) => p.type === "lyrics" && p.segments.some((s) => s.chord),
  );

  // Nothing but lyrics: the fetched ones are the whole of the answer.
  if (!inline && !kinds.some((k) => k !== "lyric" && k !== "blank")) {
    const timings = lrc.map((l, line) => ({
      line,
      text: normalizeLine(l.text),
      t: l.t,
    }));
    return {
      ok: true,
      lyrics: lrc.map((l) => l.text).join("\n"),
      timings,
      report: {
        replaced: true,
        matched: 0,
        total: 0,
        chords: 0,
        moved: 0,
        other: 0,
      },
    };
  }

  // The sheet as UNITS in its own order: a lyric line (with the chords over it), or something floating.
  type Unit =
    | { lyric: number; text: string; chords: Placed[]; raw: string }
    | { floating: Floating };
  const units: Unit[] = [];
  for (let i = 0; i < raw.length; i++) {
    const kind = kinds[i];
    if (kind === "tab") {
      // A tablature block is its consecutive lines, kept together.
      const block = [raw[i]];
      while (i + 1 < raw.length && kinds[i + 1] === "tab") block.push(raw[++i]);
      units.push({ floating: { lines: block, kind } });
    } else if (kind === "chords" && kinds[i + 1] === "lyric") {
      // Chords right above a lyric line are ITS chords.
      const p = parsed[i + 1];
      const text =
        p.type === "lyrics"
          ? p.segments.map((s) => s.text).join("")
          : raw[i + 1];
      units.push({
        lyric: units.length,
        text,
        chords: chordTokens(raw[i]),
        raw: raw[i + 1],
      });
      i++;
    } else if (kind === "lyric") {
      const p = parsed[i];
      const segs = p.type === "lyrics" ? p.segments : [];
      // Inline `[C]` chords, at the column their text starts.
      const chords: Placed[] = [];
      let col = 0;
      for (const s of segs) {
        if (s.chord) chords.push({ col, text: s.chord });
        col += s.text.length;
      }
      units.push({
        lyric: units.length,
        text: segs.map((s) => s.text).join("") || raw[i],
        chords,
        raw: raw[i],
      });
    } else {
      units.push({ floating: { lines: [raw[i]], kind } });
    }
  }

  const lyricUnits = units.filter(
    (u): u is Extract<Unit, { lyric: number }> => "lyric" in u,
  );
  const fetched = lrc.map((l) => normalizeLine(l.text));
  // Two sheet lines may be one fetched line only when nothing stood between them.
  const joinable = lyricUnits.map((u, k) => {
    const next = lyricUnits[k + 1];
    return !!next && units.indexOf(next) === units.indexOf(u) + 1;
  });
  const spans = alignSpans(
    lyricUnits.map((u) => normalizeLine(u.text)),
    fetched,
    MERGE_THRESHOLD,
    joinable,
  );
  // Which fetched lines each matched sheet line became: the first is where what stood BEFORE it
  // goes, the last where what stood after it goes.
  const toLrc = new Map<number, number>();
  const lastLrc = new Map<number, number>();
  // The chords each fetched line carries, moved off the sheet line(s) it matched.
  const chordsOn = new Map<number, Placed[]>();
  for (const s of spans) {
    const olds = lyricUnits.slice(s.i, s.i + s.ni);
    for (const u of olds) {
      toLrc.set(u.lyric, s.j);
      lastLrc.set(u.lyric, s.j + s.nj - 1);
    }
    // Both sides as ONE line — the sheet's lines joined, the fetched ones joined — and the chords moved across.
    let from = "";
    const chords: Placed[] = [];
    for (const u of olds) {
      if (from) from += " ";
      for (const c of u.chords) chords.push({ ...c, col: c.col + from.length });
      from += u.text;
    }
    if (!chords.length) continue;
    const first = lrc[s.j].text;
    const to = s.nj === 1 ? first : `${first} ${lrc[s.j + 1].text}`;
    // …then split back where the fetched line breaks: a chord at the join goes to the second line.
    for (const c of moveChords(from, to, chords)) {
      const second = s.nj === 2 && c.col > first.length;
      const j = second ? s.j + 1 : s.j;
      const col = second ? c.col - first.length - 1 : c.col;
      chordsOn.set(j, [
        ...(chordsOn.get(j) ?? []),
        { ...c, col: Math.max(0, col) },
      ]);
    }
  }
  // A line sung again — a chorus the sheet wrote once — takes the chords of its first time.
  for (let j = 0; j < lrc.length; j++) {
    if (chordsOn.has(j)) continue;
    for (const [k, placed] of [...chordsOn].sort((a, b) => a[0] - b[0])) {
      if (similarity(fetched[k], fetched[j]) >= REPEAT) {
        chordsOn.set(j, moveChords(lrc[k].text, lrc[j].text, placed));
        break;
      }
    }
  }

  // Where each floating piece goes: before the fetched line its NEXT matched lyric became, else
  // after the one its previous matched lyric became, else at the end.
  const before = new Map<number, Floating[]>();
  const after = new Map<number, Floating[]>();
  const atEnd: Floating[] = [];
  const other: string[] = [];
  const nextMatched = (from: number) => {
    for (let k = from; k < units.length; k++) {
      const u = units[k];
      if ("lyric" in u && toLrc.has(u.lyric)) return toLrc.get(u.lyric);
    }
    return undefined;
  };
  const prevMatched = (from: number) => {
    for (let k = from; k >= 0; k--) {
      const u = units[k];
      if ("lyric" in u && lastLrc.has(u.lyric)) return lastLrc.get(u.lyric);
    }
    return undefined;
  };
  const place = (k: number, piece: Floating) => {
    const next = nextMatched(k + 1);
    if (next !== undefined)
      return void before.set(next, [...(before.get(next) ?? []), piece]);
    const prev = prevMatched(k - 1);
    if (prev !== undefined)
      return void after.set(prev, [...(after.get(prev) ?? []), piece]);
    atEnd.push(piece);
  };
  let moved = 0;
  units.forEach((u, k) => {
    if ("floating" in u) {
      if (u.floating.kind !== "blank") moved++;
      return place(k, u.floating);
    }
    if (toLrc.has(u.lyric)) return;
    // A sheet line the fetched lyrics do not have. Its chords are kept, as a line of their own;
    // its words are dropped when they are a variant of the fetched ones, and kept otherwise.
    if (u.chords.length) {
      moved++;
      place(k, { lines: [renderChordLine(u.chords)], kind: "chords" });
    }
    const variant = fetched.some(
      (f) => similarity(normalizeLine(u.text), f) >= VARIANT,
    );
    if (!variant && u.text.trim()) other.push(u.raw);
  });

  // The document, fetched line by fetched line, with what the sheet had put around them.
  const out: string[] = [];
  const timings: LyricTiming[] = [];
  const emit = (piece: Floating) => {
    if (piece.kind === "blank") {
      if (out.length && out[out.length - 1] !== "") out.push("");
      return;
    }
    // A section opens a stanza: a blank line before it, unless one is there.
    if (piece.kind === "section" && out.length && out[out.length - 1] !== "")
      out.push("");
    out.push(...piece.lines);
  };
  lrc.forEach((l, j) => {
    for (const piece of before.get(j) ?? []) emit(piece);
    const placed = chordsOn.get(j);
    if (placed) out.push(renderChordLine(placed));
    timings.push({ line: out.length, text: normalizeLine(l.text), t: l.t });
    out.push(l.text);
    for (const piece of after.get(j) ?? []) emit(piece);
  });
  for (const piece of atEnd) emit(piece);
  while (out.length && out[out.length - 1] === "") out.pop();
  if (other.length) out.push("", OTHER_SECTION, ...other);

  return {
    ok: true,
    lyrics: out.join("\n"),
    timings,
    report: {
      replaced: false,
      matched: toLrc.size,
      total: Math.min(lyricUnits.length, lrc.length),
      chords: chordsOn.size,
      moved,
      other: other.length,
    },
  };
}
