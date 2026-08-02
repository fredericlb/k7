// trackMix.ts — mixer mutations: set a track's scalar fields (volume/pan/mute/solo) by
// rewriting its file in place, so the change round-trips the same way for every surface
// (TUI watcher, web refetch) that reloads it. A surgical edit, not a re-serialization.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entityFileFor } from "./yaml/moduleIO";
import {
  addPlacement,
  findPlacementAt,
  movePlacementAt,
  placementAt,
  removePlacementAt,
  setPlacementField,
  setTrackField,
} from "./yaml/trackFile";

export type TrackFields = Partial<{
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  disabled: boolean;
  // The freeze render's path, or null to REMOVE the key — unfreezing has to leave no trace of the attribute, and
  // writing an empty string would leave a `frozen: ""` the schema rejects.
  frozen: string | null;
}>;

// --- gain / pan conversions (shared by the handlers and every mixer) ----------
// A track's `volume` is a LINEAR GAIN, not dB (1.0 == unity, 0.5 == -6 dB).

export const MIN_GAIN_DB = -60; // fader floor; below this we store silence

// +6 dB, no higher: Tracktion's fader position saturates at 1.0 there, so a louder value plays at +6 anyway.
export const MAX_GAIN_DB = 6;
export const MAX_GAIN = 10 ** (MAX_GAIN_DB / 20); // ~1.9953

// linear gain -> dB (‑inf at/below silence).
export function gainToDb(linear: number): number {
  return linear <= 0 ? -Infinity : 20 * Math.log10(linear);
}

// dB -> linear gain, clamped in dB (not on the converted gain) so the ceiling is the one number the fader also uses.
export function dbToGain(db: number): number {
  if (db <= MIN_GAIN_DB) return 0;
  return 10 ** (Math.min(MAX_GAIN_DB, db) / 20);
}

// A short human label for a stored pan (0..1, 0.5 == centre): "C", "L50", "R30".
export function panToLabel(pan: number): string {
  const off = Math.round((pan - 0.5) * 200); // -100..+100
  if (off === 0) return "C";
  return off < 0 ? `L${-off}` : `R${off}`;
}

// --- writing a track's file --------------------------------------------------
// A placement is addressed by its POSITION IN BEATS, not the text of its `start`
// (see yaml/trackFile.ts, which owns the writes) — "1:1:1"/"1:1"/"1" are one position.

/** Rewrite track `id`'s file in place via `transform` on its text; throws when the track has no file (`what` names the edit in the message). */
export function editTrackStruct(
  dir: string,
  id: string,
  transform: (text: string) => string,
  what: string,
): string {
  const found = entityFileFor(join(dir, "tracks"), "tracks", id);
  if (!found)
    throw new Error(`track "${id}" has no file in tracks/ — cannot ${what}`);
  const text = readFileSync(found.path, "utf8");
  const next = transform(text);
  if (next !== text) writeFileSync(found.path, next, "utf8");
  return found.path;
}

// Move a placement to ANOTHER track's file, carried over WHOLE; cut first, so a miss leaves both files untouched.
// Caller's job: refuse a move between tracks of different kinds (see the event.move command).
export function movePlacementToTrack(
  dir: string,
  fromId: string,
  toId: string,
  fromBeats: number,
  toTc: string,
  num: number,
  den: number,
): boolean {
  let cut: Record<string, unknown> | null = null;
  editTrackStruct(
    dir,
    fromId,
    (text) => {
      const at = findPlacementAt(text, fromBeats, num, den);
      if (at < 0) return text;
      cut = placementAt(text, at);
      return cut ? removePlacementAt(text, at) : text;
    },
    `move a placement off track "${fromId}"`,
  );
  if (!cut) return false;

  editTrackStruct(
    dir,
    toId,
    (text) => addPlacement(text, { ...(cut as object), start: toTc } as never),
    `move a placement onto track "${toId}"`,
  );
  return true;
}

/** Move the placement at `fromBeats` to `toTc`, leaving the rest of the file alone. Returns true if one moved. */
export function moveTrackPlacement(
  dir: string,
  id: string,
  fromBeats: number,
  toTc: string,
  num: number,
  den: number,
): boolean {
  let moved = false;
  editTrackStruct(
    dir,
    id,
    (text) => {
      const at = findPlacementAt(text, fromBeats, num, den);
      if (at < 0) return text;
      moved = true;
      return movePlacementAt(text, at, toTc);
    },
    "move a clip",
  );
  return moved;
}

/** Switch the placement at `fromBeats` on or off. Returns true if one was there. The
 *  flag is written when true and DELETED when false, so switching back leaves the file
 *  as it was rather than accumulating `disabled: false` on every event ever touched. */
export function setTrackPlacementDisabled(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  disabled: boolean,
): boolean {
  let hit = false;
  editTrackStruct(
    dir,
    id,
    (text) => {
      const at = findPlacementAt(text, fromBeats, num, den);
      if (at < 0) return text;
      hit = true;
      return setPlacementField(text, at, "disabled", disabled || undefined);
    },
    "disable a clip",
  );
  return hit;
}

/** Re-time the placement at `fromBeats`: a new start and a new length, written together
 *  so a resize is ONE edit — two would leave a moment where the event is at its new
 *  start with its old length, and a reload landing between them would show that. */
export function resizeTrackPlacement(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  startTc: string,
  lengthTc: string,
): boolean {
  let hit = false;
  editTrackStruct(
    dir,
    id,
    (text) => {
      const at = findPlacementAt(text, fromBeats, num, den);
      if (at < 0) return text;
      hit = true;
      return setPlacementField(
        setPlacementField(text, at, "start", startTc),
        at,
        "length",
        lengthTc,
      );
    },
    "resize a clip",
  );
  return hit;
}

/** Remove the placement at `fromBeats`. The clip/sequence itself is NOT touched (only the reference) — deleting the last placement just leaves it unplaced. */
export function removeTrackPlacement(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
): boolean {
  let removed = false;
  editTrackStruct(
    dir,
    id,
    (text) => {
      const at = findPlacementAt(text, fromBeats, num, den);
      if (at < 0) return text;
      removed = true;
      return removePlacementAt(text, at);
    },
    "remove a clip",
  );
  return removed;
}

/** Apply `fields` to track `id`. Returns the path written. */
export function setTrackFields(
  dir: string,
  id: string,
  fields: TrackFields,
): string {
  return editTrackStruct(
    dir,
    id,
    (text) => {
      let out = text;
      for (const [k, v] of Object.entries(fields))
        if (v !== undefined) out = setTrackField(out, k, v);
      return out;
    },
    `set ${Object.keys(fields).join(", ")}`,
  );
}
