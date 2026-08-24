// trackTakes.ts — the lane-level face of trackFile's take writers, plus the arithmetic that says
// WHICH placements a take holds. A take is what a pass DISPLACED, not the whole lane, so both
// recording and `track take select` hand a list of clips down. See packages/song/docs/takes.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import {
  findPlacementAt,
  pushEventsToTake,
  removeAllTakes,
  removeTake,
  selectTake,
  takeValues,
} from "@studio/song-schema/yaml/trackFile";
import { editTrackStruct } from "./trackMix";

/** A clip as the COMPILED document reports it — in beats, windows and loops folded in. */
export interface ClipSpan {
  start: number;
  length: number; // 0 == the compiler could not measure it, docs/takes.md
}

// A hair under a tick: two clips that merely touch, end to start, are not on top of each other.
const TOUCHING = 1e-6;

/** Do these two sound at once? One the compiler could not measure counts as its start alone. */
function together(a: ClipSpan, b: ClipSpan): boolean {
  const end = (s: ClipSpan) => s.start + Math.max(s.length, 0);
  return a.start < end(b) - TOUCHING && end(a) > b.start + TOUCHING;
}

/** `clips` split by whether they sound under one of `spans` — each side a list of STARTS in beats. */
export function splitUnder(
  clips: ClipSpan[],
  spans: ClipSpan[],
): { under: number[]; clear: number[] } {
  const under: number[] = [];
  const clear: number[] = [];
  for (const c of clips)
    (spans.some((s) => together(c, s)) ? under : clear).push(c.start);
  return { under, clear };
}

/** WHICH placements an edit addresses: their starts in beats, as `splitUnder` reads them off the doc. */
export interface Picks {
  beats: number[];
  num: number;
  den: number;
}

/** Those starts as indices into what the lane is PLAYING — the form the YAML writers take. */
function indicesFor(text: string, picks: Picks): number[] {
  return picks.beats
    .map((b) => findPlacementAt(text, b, picks.num, picks.den))
    .filter((i) => i >= 0);
}

/** Set aside what lane `id` plays, as a new take; `only` narrows it to what a pass displaced. */
export function pushTrackClipsToTake(
  dir: string,
  id: string,
  name?: string,
  only?: Picks,
): boolean {
  let pushed = false;
  editTrackStruct(
    dir,
    id,
    (text) => {
      const next = pushEventsToTake(text, name, only && indicesFor(text, only));
      pushed = next !== text;
      return next;
    },
    `set aside track "${id}"'s clips`,
  );
  return pushed;
}

/** Swap take `n` (1-based) onto lane `id`, `keep` staying beside it. Throws if there is no take `n`. */
export function selectTrackTake(
  dir: string,
  id: string,
  n: number,
  keep?: Picks,
): string {
  return editTrackStruct(
    dir,
    id,
    (text) => selectTake(text, n, keep && indicesFor(text, keep)),
    `select take ${n} on track "${id}"`,
  );
}

/** Delete take `n` (1-based) from lane `id`, and the clips it held. Throws if there is none. */
export function removeTrackTake(dir: string, id: string, n: number): string {
  return editTrackStruct(
    dir,
    id,
    (text) => removeTake(text, n),
    `delete take ${n} on track "${id}"`,
  );
}

/** Keep what lane `id` is playing and drop every take. Returns how many went. */
export function keepTrackTake(dir: string, id: string): number {
  const had = trackTakes(dir, id).length;
  if (had)
    editTrackStruct(dir, id, removeAllTakes, `keep track "${id}"'s take`);
  return had;
}

/** The takes lane `id` holds, in order — for a caller counting them or listing them. */
export function trackTakes(
  dir: string,
  id: string,
): { name?: string; events: unknown[] }[] {
  const found = entityFileFor(join(dir, "nodes"), "nodes", id);
  if (!found) return [];
  return takeValues(readFileSync(found.path, "utf8"));
}
