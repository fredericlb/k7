// takes.ts — what the TAKES view of the waveform and piano roll panels draws, off the open project:
// the event a clip belongs to (a comped event is several clips, each marked with its event), its
// takes as rows, and which spans of each row the comp plays. Pure, so the arithmetic is a test.
// See packages/song/docs/takes.md and docs/clipEditors.md.

import { materialRefOf } from "@studio/song-schema/placementId";
import {
  beatsToDuration,
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "@studio/song-schema/timecode";
import type { WebClip, WebProject } from "./types";

/** One row of the view: a take, or the event's own material, starting at `start` beats. */
export interface TakeRow {
  ref: string;
  start: number;
  own: boolean;
}

/** An event with its takes, everything in song BEATS. */
export interface TakesEvent {
  track: string;
  ref: string;
  /** Where the event starts, as beats and as the timecode the event verbs name it by. */
  start: number;
  at: string;
  kind: "audio" | "midi";
  rows: TakeRow[];
  comp: { take: string; from: number; to: number }[];
  /** What the engine plays of it, in order — the folded clip's pieces, or the event's one clip when it is not comped. */
  pieces: WebClip[];
  /** The crossfades at its seams: centred on `at`, `length` beats long. */
  crossfades: { at: number; length: number }[];
  /** The span the event's clips cover, comp included — what the view frames. */
  from: number;
  to: number;
}

/** The event a clip belongs to: a piece of a comp names it, an uncomped clip IS it — stable across a re-comp. */
export const eventIdOf = (clip: Pick<WebClip, "id" | "comp">): string =>
  clip.comp?.of ?? clip.id;

/** The event `eventId` on `track`, with its takes and comp — null when no clip of it is on that lane. */
export function takesEventOf(
  project: WebProject,
  track: string,
  eventId: string,
): TakesEvent | null {
  const lane = project.tracks.find((t) => t.id === track);
  const pieces = (lane?.clips ?? []).filter(
    (c) => c.id === eventId || c.comp?.of === eventId,
  );
  const clip = pieces[0];
  if (!lane || !clip) return null;
  const at = eventId.lastIndexOf("@");
  const start = Number(eventId.slice(at + 1));
  const ref = materialRefOf(eventId);
  if (!Number.isFinite(start)) return null;
  const num = project.timeSigNumerator;
  const den = project.timeSigDenominator;
  const pos = (tc: string) => parsePosition(tc, num, den);
  const ev = (pieces.find((c) => c.event)?.event ?? {}) as NonNullable<
    WebClip["event"]
  >;
  const rows: TakeRow[] = [
    { ref, start, own: true },
    ...(ev.takes ?? []).map((t) => ({
      ref: t.ref,
      start: pos(t.start),
      own: false,
    })),
  ];
  const comp = (ev.comp ?? []).map((s) => ({
    take: s.take,
    from: pos(s.from),
    to: pos(s.to),
  }));
  const crossfades = (ev.crossfades ?? []).map((x) => ({
    at: pos(x.at),
    length: parseDuration(x.length, num, den),
  }));
  const ends = pieces.map((c) => c.start + (c.length || 0));
  return {
    track,
    ref,
    start,
    at: beatsToPosition(start, num, den),
    kind: clip.type,
    rows,
    comp,
    crossfades,
    pieces: [...(clip.pieces ?? pieces)].sort((a, b) => a.start - b.start),
    from: Math.min(start, ...pieces.map((c) => c.start)),
    to: Math.max(start, ...ends),
  };
}

/** The spans of song time row `ref` is HEARD over: its comp spans, and for the event's own, what no span covers. */
export function heardSpans(
  ev: TakesEvent,
  row: TakeRow,
  rowEnd: number,
): { from: number; to: number }[] {
  if (!row.own)
    return ev.comp
      .filter((s) => s.take === row.ref)
      .map((s) => ({ from: s.from, to: s.to }));
  let spans = [{ from: row.start, to: rowEnd }];
  for (const s of ev.comp)
    spans = spans.flatMap((h) =>
      s.to <= h.from || s.from >= h.to
        ? [h]
        : [
            ...(s.from > h.from ? [{ from: h.from, to: s.from }] : []),
            ...(s.to < h.to ? [{ from: s.to, to: h.to }] : []),
          ],
    );
  return spans;
}

/** A dragged span, snapped to `grid` beats and put in order — null for a click, which seeks rather than selects. */
export function snapSpan(
  a: number,
  b: number,
  grid: number,
): { from: number; to: number } | null {
  const snap = (x: number) => Math.round(x / grid) * grid;
  const from = snap(Math.min(a, b));
  const to = snap(Math.max(a, b));
  return to - from >= grid ? { from, to } : null;
}

/** The line that plays `ref` over `span` — the one command a pick is. */
export function compLine(
  ev: TakesEvent,
  ref: string,
  span: { from: number; to: number },
  num: number,
  den: number,
): string {
  const pos = (b: number) => beatsToPosition(b, num, den);
  return `event comp ${ev.track} ${ev.at} ${ref} ${pos(span.from)} ${pos(span.to)}`;
}

/** The line that arms the next take into `ev`: punched into the selection, or from the playhead to the stop. */
export function armLine(
  ev: TakesEvent,
  from: number,
  to: number | null,
  num: number,
  den: number,
): string {
  const pos = (b: number) => beatsToPosition(b, num, den);
  return `event take arm ${ev.track} ${ev.at} ${pos(from)}${to === null ? "" : ` ${pos(to)}`}`;
}

/** Where two pieces of the comp meet inside the event — the places a crossfade can go. */
export function compSeams(ev: TakesEvent): number[] {
  const inside = (b: number) => b > ev.start + 1e-6 && b < ev.to - 1e-6;
  const all = ev.comp.flatMap((s) => [s.from, s.to]).filter(inside);
  return [...new Set(all.map((b) => Math.round(b * 1e6) / 1e6))].sort(
    (a, b) => a - b,
  );
}

/** The line that crossfades the seam `seam` over `beats` — 0 removes it. */
export function compFadeLine(
  ev: TakesEvent,
  seam: number,
  beats: number,
  num: number,
  den: number,
): string {
  const len = beats > 0 ? beatsToDuration(beats, num, den) : "0";
  return `event comp fade ${ev.track} ${ev.at} ${beatsToPosition(seam, num, den)} ${len}`;
}

/** One colour per take, by its row: the event's own first. The same in the takes view and the comp strip. */
export const TAKE_COLORS = [
  "#38bdf8",
  "#f59e0b",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#facc15",
  "#fb7185",
  "#60a5fa",
];

export function takeColor(ev: TakesEvent, ref: string): string {
  const i = Math.max(
    0,
    ev.rows.findIndex((r) => r.ref === ref),
  );
  return TAKE_COLORS[i % TAKE_COLORS.length];
}

/** The take a piece plays: its comp marker, else its own material. */
export const takeOfPiece = (p: WebClip): string => p.comp?.take || p.name;

/** A piece's edges dragged to `from..to` (song beats), as comp lines: grown, its take takes the span; shrunk, the neighbour takes back what it let go. */
export function pieceEdgeLines(
  ev: TakesEvent,
  piece: WebClip,
  from: number,
  to: number,
  num: number,
  den: number,
): string[] {
  const i = ev.pieces.findIndex((p) => p.id === piece.id);
  if (i < 0 || to <= from) return [];
  const start = piece.start;
  const end = piece.start + piece.length;
  const EPS = 1e-6;
  // What a released span goes back to: the piece it touches (a seam crossfade overlaps them), else the event's own.
  const neighbour = (q: WebClip | undefined, at: number): string =>
    q && Math.abs((at === start ? q.start + q.length : q.start) - at) < 2
      ? takeOfPiece(q)
      : ev.ref;
  const take = takeOfPiece(piece);
  const lines: string[] = [];
  if (from > start + EPS)
    lines.push(
      compLine(
        ev,
        neighbour(ev.pieces[i - 1], start),
        { from: start, to: from },
        num,
        den,
      ),
    );
  if (to < end - EPS)
    lines.push(
      compLine(
        ev,
        neighbour(ev.pieces[i + 1], end),
        { from: to, to: end },
        num,
        den,
      ),
    );
  if (from < start - EPS || to > end + EPS)
    lines.push(compLine(ev, take, { from, to }, num, den));
  return lines;
}
