// waveform.ts — the arithmetic behind a playhead-centric waveform: which slice of a song is
// on screen, where a second lands in pixels, and where the beats are. No canvas, no React, so
// the parts that decide what you SEE are testable. See docs/waveform.md.

/** What the file service hands back for one cached song (@studio/commands/waveform's shape). */
export interface Envelope {
  sampleRate: number;
  channels: number;
  frames: number;
  seconds: number;
  /** Per-bucket max |sample|, 0..1. 8192 buckets for a whole file, whatever its length. */
  peak: number[];
  rms: number[];
  /** Onsets in FILE seconds, as the engine detected them. */
  transients: number[];
  sensitivity: number;
  /** The engine's estimate, or 0 for "none found". A starting point, not an authority. */
  bpm: number;
}

/** How many seconds of song are visible at once. A DJ's window: enough to see the next
 *  phrase coming, tight enough that a beat is a distance and not a hair. */
export const WINDOW_SECONDS = 8;

/**
 * The seconds visible at playhead `at`, with the playhead in the MIDDLE.
 *
 * Deliberately not clamped to the song. At the start the left half is before zero and at the
 * end the right half is past the end, and both are drawn empty — that emptiness is the
 * information ("you are at the beginning", "the track is about to run out"), and a window
 * that slid to stay inside the file would put the playhead somewhere other than the centre
 * and quietly break the one promise this view makes.
 */
export function window(at: number, span = WINDOW_SECONDS): [number, number] {
  return [at - span / 2, at + span / 2];
}

/** Where a moment in the song falls, 0..1 across the view. Outside means off-screen. */
export function xOf(
  seconds: number,
  at: number,
  span = WINDOW_SECONDS,
): number {
  return (seconds - (at - span / 2)) / span;
}

/**
 * The peak bucket covering `seconds`, or null when that is outside the file.
 *
 * The envelope holds a fixed number of buckets for the whole file, so the seconds-per-bucket
 * depends on the song's length — a bucket of a three-minute track is a different slice of
 * time than one of a ten-minute track. Nothing downstream may assume otherwise.
 */
export function bucketAt(env: Envelope, seconds: number): number | null {
  if (!(env.seconds > 0) || !env.peak.length) return null;
  if (seconds < 0 || seconds >= env.seconds) return null;
  const i = Math.floor((seconds / env.seconds) * env.peak.length);
  return i >= 0 && i < env.peak.length ? i : null;
}

/**
 * The beats of a song, in file seconds, across `[from, to]`.
 *
 * **The grid is an ESTIMATE, and the anchor is the honest part.** A tempo says how far apart
 * the beats are; it says nothing about where the first one is, and nothing in the médiathèque
 * carries a downbeat — `song.yaml` has a `bpm` a person may correct, and no offset. A grid
 * anchored at 0 would be wrong for every track with a lead-in, which is most of them.
 *
 * So the anchor is the first transient the engine found: the first onset is the best
 * available guess at where the music starts, and on a track that opens on the beat it is
 * exactly right. When a real first-beat offset lands in the sidecar, `anchor` is the one
 * argument that changes.
 *
 * Returns nothing at all when there is no tempo — a grid drawn at a guessed 120 would be a
 * confident lie, and no yellow lines reads correctly as "the tempo is not known".
 */
export function beatsIn(
  env: Envelope,
  from: number,
  to: number,
  /** Hard ceiling, so a bad tempo on a long window cannot ask for a million lines. */
  max = 512,
): number[] {
  if (!(env.bpm > 0) || !(to > from)) return [];
  const period = 60 / env.bpm;
  if (!(period > 0) || !Number.isFinite(period)) return [];
  const anchor = env.transients.length ? env.transients[0] : 0;
  // The first beat at or after `from`, counted from the anchor — which may be negative, since
  // the grid extends backwards through a lead-in as much as forwards.
  const first = Math.ceil((from - anchor) / period);
  const out: number[] = [];
  for (let k = first; out.length < max; k++) {
    const t = anchor + k * period;
    if (t > to) break;
    if (t >= 0) out.push(t);
  }
  return out;
}

/**
 * Seconds as `m:ss`, and `-m:ss` for what is left.
 *
 * On the strip because a deck needs it, and because it is the one thing that makes the
 * PLAYHEAD's movement visible: a waveform of a quiet intro and a waveform that is not
 * advancing look identical, and a clock that stays at 0:00 while sound comes out says which
 * of the two you are looking at.
 */
export function mmss(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(seconds));
  const m = Math.floor(whole / 60);
  return `${sign}${m}:${String(whole % 60).padStart(2, "0")}`;
}

/** The transients falling inside `[from, to]`. A plain filter — they are already sorted and
 *  already in file seconds, so nothing here interprets them. */
export function transientsIn(
  env: Envelope,
  from: number,
  to: number,
): number[] {
  return env.transients.filter((t) => t >= from && t <= to);
}
