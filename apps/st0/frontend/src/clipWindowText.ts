// A clip file's own window (`from`/`to`), read from and written back into the OPEN BUFFER's text.
//
// Text and not a parsed document, for the reason sliceSymbols.ts gives about slices: the band is
// drawn from what you are typing, and a drag rewrites the two values in place rather than reflowing
// the file under the cursor. See apps/st0/frontend/docs/clipEditors.md.

import { beatsToPosition, parsePosition } from "@studio/song/timecode";

/** The project grid a timecode edge needs, and the one a dragged edge is written back on. */
export interface ClipGrid {
  tempo: number;
  num: number;
  den: number;
}

/** One edge as the file spells it: the raw text, and where it sits so it can be replaced in place. */
interface Edge {
  raw: string;
  range: [number, number];
}

// A top-level `from:`/`to:` and the span of its VALUE. Anchored to the start of a line so a `from`
// inside a nested block — a rack symbol's, a warp marker's — is never the one that gets rewritten.
const edgeRe = (key: string) =>
  new RegExp(`^${key}[ \\t]*:[ \\t]*("[^"]*"|'[^']*'|[^\\n#]*)`, "m");

/** Where this clip file states its window, if it does — one entry per edge that is written. */
export function scanClipWindow(text: string): { from?: Edge; to?: Edge } {
  const one = (key: string): Edge | undefined => {
    const m = edgeRe(key).exec(text);
    if (!m) return undefined;
    // The VALUE's span, not the pair's: `m[1]` may have trailing spaces the regex swallowed, and
    // replacing those too would eat the gap before a trailing comment.
    const raw = m[1].trimEnd();
    const at = m.index + m[0].length - m[1].length;
    return { raw, range: [at, at + raw.length] };
  };
  const from = one("from");
  const to = one("to");
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/** A written edge in SECONDS, or null when it is absent or half-typed. */
function edgeSeconds(raw: string | undefined, g: ClipGrid): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return n >= 0 ? n : null; // already seconds
  try {
    return (parsePosition(unquote(raw), g.num, g.den) * 60) / g.tempo;
  } catch {
    return null; // half-typed timecode — say nothing rather than jump about
  }
}

const unquote = (s: string) =>
  (s.startsWith('"') && s.endsWith('"')) ||
  (s.startsWith("'") && s.endsWith("'"))
    ? s.slice(1, -1)
    : s;

/**
 * The window as ONE band to draw over the source — the shape the waveform's overlay already takes.
 *
 * `to` comes back as Infinity when unwritten, which is what "to the end of the file" is on an axis
 * only the view knows the length of.
 *
 * With neither edge written the band is **hollow**: its two edges are the file's own, and there is
 * nothing to shade — a wash over the whole picture would make "not trimmed" look like an edit, and
 * that is the one thing this drawing must not say. It is returned all the same when `editable`,
 * because the edges are the HANDLES: without a band there is nothing to grab, and a clip could
 * never be trimmed by dragging, only by having been trimmed already. Read-only, it stays undefined.
 */
export function clipWindowBand(
  text: string,
  g: ClipGrid,
  editable = false,
):
  | { symbol: string; from: number; to: number; hollow?: boolean }[]
  | undefined {
  const w = scanClipWindow(text);
  const from = edgeSeconds(w.from?.raw, g);
  const to = edgeSeconds(w.to?.raw, g);
  if (from == null && to == null)
    return editable
      ? [
          {
            symbol: "clip",
            from: 0,
            to: Number.POSITIVE_INFINITY,
            hollow: true,
          },
        ]
      : undefined;
  return [
    { symbol: "clip", from: from ?? 0, to: to ?? Number.POSITIVE_INFINITY },
  ];
}

/** Seconds, to 0.1 ms — the precision the slice handles already commit at. */
const tidy = (s: number) => Math.round(s * 10000) / 10000;

/**
 * How to spell a dragged edge: the way it was already spelled.
 *
 * A number stays a number and a timecode stays a timecode, and that is not politeness — the two
 * mean different things when the tempo changes. A bare number is seconds into the file and holds
 * still; a timecode is musical and follows the grid (see AudioClipSchema). Rewriting one as the
 * other during a drag would silently change what the clip is pinned to, which is exactly the kind
 * of edit nobody would look for afterwards.
 *
 * An edge that was ABSENT is written in seconds: there is no intent to preserve, and the drag
 * itself happened on an axis of source seconds.
 */
function spell(seconds: number, was: string | undefined, g: ClipGrid): string {
  if (was != null && !Number.isFinite(Number(was))) {
    try {
      // Quoted, always: `to: 3:1` unquoted is sexagesimal in YAML 1.1 and would load as beat 181.
      return `"${beatsToPosition((seconds * g.tempo) / 60, g.num, g.den)}"`;
    } catch {
      /* it was not a timecode after all — fall through to seconds */
    }
  }
  return String(tidy(seconds));
}

/**
 * Rewrite the clip's `from`/`to` in `text`, answering the new text.
 *
 * Both edges every time, because a drag commits the pair the band was showing — the other edge
 * simply gets its own value back, and an unchanged value writes the same characters.
 *
 * The two house rules for an absent edge are kept: a `from` of 0 is DELETED rather than written,
 * since absent already means "the material's start" and a file full of zeroes makes "not trimmed"
 * and "trimmed to the beginning" read alike; and a non-finite `to` is the file's end, which is
 * said by leaving the key out. A key that has to APPEAR goes at the end of the document, where
 * the file service's own writer puts it.
 */
export function setClipWindowText(
  text: string,
  from: number,
  to: number,
  g: ClipGrid,
): string {
  const w = scanClipWindow(text);
  const want: { key: "from" | "to"; val: string | null; at?: Edge }[] = [
    {
      key: "from",
      val: from > 0 ? spell(from, w.from?.raw, g) : null,
      ...(w.from ? { at: w.from } : {}),
    },
    {
      key: "to",
      val: Number.isFinite(to) ? spell(to, w.to?.raw, g) : null,
      ...(w.to ? { at: w.to } : {}),
    },
  ];

  // In place first, LATER range before earlier, so the earlier one's offsets stay true.
  let out = text;
  for (const e of [...want]
    .filter((e) => e.at)
    .sort((a, b) => (b.at as Edge).range[0] - (a.at as Edge).range[0])) {
    const [s, t] = (e.at as Edge).range;
    out =
      e.val == null ? dropLine(out, s) : out.slice(0, s) + e.val + out.slice(t);
  }
  // Then whatever had no line to rewrite. Appended in the pair's own order, so a clip that gains
  // both reads `from` then `to` rather than the order the loop happened to run in.
  for (const e of want)
    if (!e.at && e.val != null)
      out = `${out.replace(/\n*$/, "")}\n${e.key}: ${e.val}\n`;
  return out;
}

/** Remove the whole line an offset falls in, newline included — deleting only the value leaves `to:`. */
function dropLine(text: string, at: number): string {
  const start = text.lastIndexOf("\n", at) + 1;
  const nl = text.indexOf("\n", at);
  return text.slice(0, start) + (nl === -1 ? "" : text.slice(nl + 1));
}
