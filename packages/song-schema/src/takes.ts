// takes.ts — an event's TAKES and its COMP, in beats: which material plays over which span of the
// song. Pure, so the compiler, the writers and the browser's takes view share one rule.
// The one thing a reader would get wrong: a comp span is in SONG time, not in the take's own time —
// a take carries where it starts, and its material is read from (span start − take start).
// See packages/song/docs/takes.md.

/** A take on an event: its material, and the song beat its material's first beat lands on. */
export interface Take {
  ref: string;
  start: number;
}

/** One span of the comp: from `from` to `to` (song beats) the event plays `take`; "" plays nothing. */
export interface CompSpan {
  take: string;
  from: number;
  to: number;
}

/** What actually plays: `ref` at song beat `start`, read from `offset` beats into it, for `length` beats (null: to its end). */
export interface Piece {
  ref: string;
  start: number;
  offset: number;
  length: number | null;
}

const EPS = 1e-9;

/** Cut `[from, to)` out of the pieces, shortening and splitting whatever crosses it. */
function cut(pieces: Piece[], from: number, to: number): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const end =
      p.length === null ? Number.POSITIVE_INFINITY : p.start + p.length;
    if (end <= from + EPS || p.start >= to - EPS) {
      out.push(p);
      continue;
    }
    if (p.start < from - EPS) out.push({ ...p, length: from - p.start });
    if (end > to + EPS)
      out.push({
        ref: p.ref,
        start: to,
        offset: p.offset + (to - p.start),
        length: p.length === null ? null : end - to,
      });
  }
  return out;
}

/** The pieces an event plays: its own material, with each comp span laid over it in order, later spans winning. */
export function compPieces(
  base: Piece,
  takes: readonly Take[],
  comp: readonly CompSpan[],
): Piece[] {
  const startOf = new Map(takes.map((t) => [t.ref, t.start]));
  startOf.set(base.ref, base.start - base.offset);
  let pieces: Piece[] = [base];
  for (const span of comp) {
    const takeStart = startOf.get(span.take);
    // Nothing before a take's first beat: a span reaching earlier is cut to where the take begins.
    const from =
      takeStart === undefined ? span.from : Math.max(span.from, takeStart);
    if (span.to <= from + EPS) continue;
    pieces = cut(pieces, from, span.to);
    if (span.take && takeStart !== undefined)
      pieces.push({
        ref: span.take,
        start: from,
        offset: from - takeStart,
        length: span.to - from,
      });
  }
  return pieces.sort((a, b) => a.start - b.start);
}

/** The comp with `span` laid over it: what it covers is taken from every other span, and the base's own spans are dropped. */
export function setCompSpan(
  comp: readonly CompSpan[],
  span: CompSpan,
  baseRef: string,
): CompSpan[] {
  const out: CompSpan[] = [];
  for (const s of comp) {
    if (s.to <= span.from + EPS || s.from >= span.to - EPS) {
      out.push(s);
      continue;
    }
    if (s.from < span.from - EPS) out.push({ ...s, to: span.from });
    if (s.to > span.to + EPS) out.push({ ...s, from: span.to });
  }
  // Picking the event's own material is the absence of a span: nothing is written for it.
  if (span.take !== baseRef) out.push(span);
  return out.sort((a, b) => a.from - b.from);
}

/** Where the event ends, beats: its own end, or the furthest a comp span reaches past it. */
export function compEnd(base: Piece, comp: readonly CompSpan[]): number | null {
  const own = base.length === null ? null : base.start + base.length;
  const reach = comp.reduce(
    (m, s) => Math.max(m, s.to),
    Number.NEGATIVE_INFINITY,
  );
  if (own === null) return null;
  return Math.max(own, reach);
}

/** A crossfade at a seam of the comp: centred on song beat `at`, `length` beats long. */
export interface Crossfade {
  at: number;
  length: number;
}

/** A piece with the fades a seam crossfade gives it, beats. */
export interface FadedPiece extends Piece {
  fadeIn?: number;
  fadeOut?: number;
}

/** Overlap the two pieces meeting at each crossfade by its length, centred on the seam — as far as their material reaches. */
export function seamCrossfades(
  pieces: readonly Piece[],
  xfades: readonly Crossfade[],
  materialLength: (ref: string) => number | null,
): FadedPiece[] {
  const out: FadedPiece[] = pieces.map((p) => ({ ...p }));
  for (const x of xfades) {
    const p = out.find(
      (q) => q.length !== null && Math.abs(q.start + q.length - x.at) < EPS,
    );
    const q = out.find((r) => Math.abs(r.start - x.at) < EPS);
    if (!p || !q || p === q || p.length === null) continue;
    // Half on each side, no more than either piece is long, nor than the material on either side of the seam.
    const room = materialLength(p.ref);
    let half = x.length / 2;
    half = Math.min(half, q.offset, p.length / 2);
    if (q.length !== null) half = Math.min(half, q.length / 2);
    if (room !== null) half = Math.min(half, room - (p.offset + p.length));
    if (!(half > EPS)) continue;
    p.length += half;
    p.fadeOut = 2 * half;
    q.start -= half;
    q.offset -= half;
    if (q.length !== null) q.length += half;
    q.fadeIn = 2 * half;
  }
  return out;
}
