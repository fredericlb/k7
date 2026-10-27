// songExtras.ts — the song page's pure readings: the chords its diagrams show, the date it was
// added, the line being sung, and the bounds of a transposition and a tempo. Kept apart from the
// components so each rule is tested once. See ../docs/songPlayer.md.

import { collectChords, transposeChord } from "@studio/lyrics/chords";
import { lineAt } from "@studio/lyrics/lrc";
import type { MediatekEntry, SongbookSong } from "@studio/mediatek/types";

export const SEMITONES_MIN = -11;
export const SEMITONES_MAX = 11;
export const BPM_MIN = 40;
export const BPM_MAX = 240;

/** A transposition, whole semitones within an octave either way. */
export const clampSemitones = (n: number): number =>
  Math.min(SEMITONES_MAX, Math.max(SEMITONES_MIN, Math.round(n)));

/** A metronome tempo, the songbook's range. */
export const clampBpm = (n: number): number =>
  Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(n)));

/** The tempo the listing carries, or null when it carries none a metronome could click. */
export function songBpm(meta: MediatekEntry["meta"]): number | null {
  const raw = meta?.bpm;
  const n = typeof raw === "number" ? raw : Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0
    ? clampBpm(n)
    : null;
}

/** Every chord the song uses — its chords' text first, then the lyrics' inline ones — as transposed, each once. */
export function songChords(
  chords: string,
  lyrics: string,
  transpose: number,
): string[] {
  const out: string[] = [];
  for (const c of [...collectChords(chords), ...collectChords(lyrics)]) {
    const shown = transposeChord(c, transpose);
    if (!out.includes(shown)) out.push(shown);
  }
  return out;
}

/** When the song was added: the songbook's own date, else the newest file time of its folder. */
export function addedOn(
  song: SongbookSong | null,
  entry: MediatekEntry,
): { at: Date; from: "songbook" | "files" } | null {
  const stamped = song?.facts.createdAt
    ? Date.parse(song.facts.createdAt)
    : NaN;
  if (Number.isFinite(stamped))
    return { at: new Date(stamped), from: "songbook" };
  return entry.mtime > 0 ? { at: new Date(entry.mtime), from: "files" } : null;
}

/** The timed line being sung at `seconds`, or null while the song is not the one playing or is at its start. */
export function followedLine(
  timings: ReadonlyMap<number, number>,
  seconds: number,
  following: boolean,
): number | null {
  return following && seconds > 0 ? lineAt(timings, seconds) : null;
}
