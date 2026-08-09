// trackAlternatives.ts — a track's clip list has VARIANTS. `clips:` is the first of them, the
// others live under `alternatives:`, and `alternative:` names the one that plays. Resolved once,
// at load, so everything downstream — the compiler, the engine, every clip command — still sees
// a track with one `clips`. See apps/l8/docs/22-syntax-material.md.
//
// NOT the same thing as `project alternative`, which is a git branch. This one is inside a track.

import type { Placement, Track } from "./yaml/trackSchema";

/** One variant of a track's clip list. */
export interface TrackAlternative {
  /** The author's name for it, or its 1-based position when unnamed. */
  name: string;
  clips: Placement[];
}

/** Only a `single` track holds clips — a group has none and a strudel lane is streamed. */
function holdsClips(t: Track): t is Extract<Track, { type: "single" }> {
  return t.type === "single";
}

/**
 * Every variant, in order, `clips:` first.
 *
 * The track's own `clips:` IS the first alternative rather than a copy of one: a song that never
 * uses the feature keeps exactly the file it had, switching writes one line instead of moving two
 * clip lists about, and an older l8 opening the file plays the historical arrangement rather than
 * nothing. The cost is that the first one cannot be named — it has nowhere to carry a name — so
 * it is always "1".
 */
export function trackAlternatives(t: Track): TrackAlternative[] {
  if (!holdsClips(t)) return [{ name: "1", clips: [] }];
  const rest = (t.alternatives ?? []).map((a, i) => ({
    name: a.name ?? String(i + 2), // +2: `clips:` already took 1
    clips: a.clips ?? [],
  }));
  return [{ name: "1", clips: t.clips ?? [] }, ...rest];
}

/**
 * Which of `names` `want` picks, as an index. THE rule, stated once.
 *
 * A NAME wins over a position, so a variant deliberately called "2" is found before the second
 * one is. Anything that matches neither falls back to the first: a typo must not silence a track,
 * and the picker showing "1" while the file says otherwise is a visible, fixable disagreement —
 * refusing to open the project would not be.
 *
 * Over plain names rather than over a Track, because the two callers do not have the same thing
 * in hand: the loader has a validated track, and the file editor deliberately has only the YAML
 * document (a file the schema rejects must still be draggable — see placementValues).
 */
export function pickAlternative(
  names: string[],
  want: string | number | undefined,
): number {
  if (want === undefined || !names.length) return 0;
  const wanted = String(want);
  const named = names.indexOf(wanted);
  if (named >= 0) return named;
  const n = Number(wanted);
  return Number.isInteger(n) && n >= 1 && n <= names.length ? n - 1 : 0;
}

/** Which one plays, as an index into `trackAlternatives`. */
export function currentAlternativeIndex(t: Track): number {
  if (!holdsClips(t)) return 0;
  return pickAlternative(
    trackAlternatives(t).map((a) => a.name),
    t.alternative,
  );
}

/** The variant that plays. */
export function currentAlternative(t: Track): TrackAlternative {
  return trackAlternatives(t)[currentAlternativeIndex(t)];
}

/** The clips the rest of the app should see — the current variant's, whichever it is. */
export function resolveTrackClips(t: Track): Placement[] {
  return currentAlternative(t).clips;
}

/** The name a new variant takes when the author gives none: the next free number. */
export function nextAlternativeName(t: Track): string {
  const taken = new Set(trackAlternatives(t).map((a) => a.name));
  for (let n = taken.size + 1; ; n++)
    if (!taken.has(String(n))) return String(n);
}
