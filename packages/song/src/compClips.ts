// compClips.ts — a comped event, compiled: its own clip and its takes' clips SLICED into the pieces
// the comp plays, each an ordinary clip the engine needs no notion of takes to play. The same slice
// cuts the hole a take is recorded into, so the old performance is not heard over the new one.
// What a reader would get wrong: a slice of AUDIO moves its window into the FILE (seconds), a slice
// of MIDI moves its window over the NOTES (beats) — one piece, two units. See docs/takes.md.

import { placementId } from "@studio/song-schema/placementId";
import {
  type CompSpan,
  type Crossfade,
  compPieces,
  type Piece,
  seamCrossfades,
  type Take,
} from "@studio/song-schema/takes";
import { parseDuration, parsePosition } from "@studio/song-schema/timecode";
import type { ClipDoc } from "./project";
import type { RawPlacement } from "./rawDoc";

/** `c` from `offset` beats into it, for `length` beats (null: to its end), placed at song beat `start`. */
export function sliceClip(
  c: ClipDoc,
  offset: number,
  length: number | null,
  start: number,
  tempo: number,
): ClipDoc {
  const rest = c.length > 0 ? c.length - offset : 0;
  const len = length ?? rest;
  // A piece starts and ends mid-performance: the event's own fades belong to its two ends, not to every cut.
  const base: ClipDoc = {
    ...c,
    id: placementId(c.name, start),
    start,
    length: len,
    fadeIn: 0,
    fadeOut: 0,
  };
  if (c.type === "midi") {
    const from = (c.loopEnd > 0 ? c.loopStart : 0) + offset;
    return { ...base, loopStart: from, loopEnd: from + len };
  }
  const secs = (beats: number) => (beats * 60) / tempo;
  const sourceFrom = (c.sourceFrom ?? 0) + secs(offset);
  const end = length === null ? c.sourceTo : sourceFrom + secs(length);
  const sourceTo =
    end === undefined
      ? undefined
      : c.sourceTo === undefined
        ? end
        : Math.min(end, c.sourceTo);
  // A stretch map is laid on the WHOLE clip's timeline; a slice of it would play the wrong beats.
  const { warp: _w, ...unwarped } = base;
  return {
    ...unwarped,
    sourceFrom,
    ...(sourceTo === undefined ? {} : { sourceTo }),
  };
}

/** The event's clips: its own alone, or the pieces of its comp, each marked with the event it belongs to. */
export function compClips(
  p: RawPlacement,
  own: ClipDoc,
  takeClip: (ref: string, start: string) => ClipDoc,
  num: number,
  den: number,
  tempo: number,
): ClipDoc[] {
  const spans = Array.isArray(p.comp) ? p.comp : [];
  // A looped event is one window repeated: there is no single span of it a take could replace.
  if (!spans.length || (p.loop ?? 1) > 1) return [own];
  const pos = (tc: unknown) => parsePosition(String(tc ?? "1"), num, den);
  const takes: Take[] = (Array.isArray(p.takes) ? p.takes : []).map((t) => ({
    ref: String(t.ref ?? ""),
    start: pos(t.start),
  }));
  const comp: CompSpan[] = spans.map((s) => ({
    take: String(s.take ?? ""),
    from: pos(s.from),
    to: pos(s.to),
  }));
  // Notes do not fade: an overlap at a MIDI seam would play both takes' notes twice, so it gets none.
  const xfades: Crossfade[] = (
    own.type === "audio" && Array.isArray(p.crossfades) ? p.crossfades : []
  ).map((x) => ({
    at: pos(x.at),
    length: parseDuration(String(x.length ?? "0"), num, den),
  }));
  const clipOf = new Map<string, ClipDoc>([[own.name, own]]);
  for (const t of p.takes ?? [])
    if (t.ref) clipOf.set(t.ref, takeClip(t.ref, String(t.start ?? "1")));
  const base: Piece = {
    ref: own.name,
    start: own.start,
    offset: 0,
    length: own.length > 0 ? own.length : null,
  };
  // How much of each material there is, beats — what a seam crossfade may reach into past a piece's end.
  const materialLength = (ref: string): number | null => {
    const c = clipOf.get(ref);
    return c && c.length > 0 ? c.length : null;
  };
  const pieces = seamCrossfades(
    compPieces(base, takes, comp),
    xfades,
    materialLength,
  );
  const first = Math.min(...pieces.map((q) => q.start));
  const last = Math.max(
    ...pieces.map((q) => (q.length === null ? q.start : q.start + q.length)),
  );
  const out: ClipDoc[] = [];
  for (const piece of pieces) {
    const c = clipOf.get(piece.ref);
    if (!c) continue;
    const end = piece.length === null ? null : piece.start + piece.length;
    // The event's own fades belong to its two ENDS; a seam's are the crossfade's.
    const fadeIn = piece.fadeIn ?? (piece.start === first ? own.fadeIn : 0);
    const fadeOut =
      piece.fadeOut ?? (end !== null && end === last ? own.fadeOut : 0);
    out.push({
      ...sliceClip(c, piece.offset, piece.length, piece.start, tempo),
      fadeIn,
      fadeOut,
      ...(piece.fadeIn || piece.fadeOut
        ? {
            crossfade: {
              ...(piece.fadeIn ? { in: true } : {}),
              ...(piece.fadeOut ? { out: true } : {}),
            },
          }
        : {}),
      comp: { of: own.id, take: piece.ref },
      ...(own.event ? { event: own.event } : {}),
    });
  }
  return out;
}

/** Mark the fades that are halves of a CROSSFADE: two clips of a lane overlapping by exactly their two fades. */
export function markCrossfades(clips: ClipDoc[]): ClipDoc[] {
  const EPS = 1e-6;
  const out = clips.map((c) => ({ ...c }));
  const audio = out
    .filter((c) => c.type === "audio" && c.length > 0)
    .sort((a, b) => a.start - b.start);
  for (const a of audio)
    for (const b of audio) {
      if (a === b || b.start <= a.start) continue;
      const overlap = a.start + a.length - b.start;
      if (
        overlap > EPS &&
        Math.abs(a.fadeOut - overlap) < EPS &&
        Math.abs(b.fadeIn - overlap) < EPS
      ) {
        a.crossfade = { ...a.crossfade, out: true };
        b.crossfade = { ...b.crossfade, in: true };
      }
    }
  return out;
}

/** The clips with `[from, to)` (song beats) cut out of them — the hole a take is recorded into. */
export function cutHole(
  clips: ClipDoc[],
  from: number,
  to: number,
  tempo: number,
): ClipDoc[] {
  const out: ClipDoc[] = [];
  for (const c of clips) {
    const end = c.length > 0 ? c.start + c.length : Number.POSITIVE_INFINITY;
    if (end <= from || c.start >= to) {
      out.push(c);
      continue;
    }
    const keep = (s: ClipDoc): ClipDoc => (c.comp ? { ...s, comp: c.comp } : s);
    if (c.start < from)
      out.push(keep(sliceClip(c, 0, from - c.start, c.start, tempo)));
    if (end > to)
      out.push(
        keep(
          sliceClip(
            c,
            to - c.start,
            Number.isFinite(end) ? end - to : null,
            to,
            tempo,
          ),
        ),
      );
  }
  return out;
}
