// trackMix.ts — mixer mutations: set a track's scalar fields (volume/pan/mute/solo) by
// rewriting its file in place, so the change round-trips the same way for every surface
// (TUI watcher, web refetch) that reloads it. A surgical edit, not a re-serialization.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type MaterialKind, resizeToWindow } from "./clipResize";
import { beatsToPosition, parsePosition } from "./timecode";
import {
  materialWindowOf,
  setMaterialWindow,
  type WindowValue,
} from "./yaml/materialFile";
import { entityFileFor, entityFiles } from "./yaml/moduleIO";
import {
  addPlacement,
  findPlacementAt,
  movePlacementAt,
  placementAt,
  placementValues,
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

/** What a resize turned out to touch — the caller reports it, since a window is SHARED. */
export interface ResizeReport {
  ref: string; // the material whose window moved
  material: string; // its project-relative path
  kind: MaterialKind;
  loops: number; // the pass count afterwards
  sharedWith: number; // OTHER placements of the same material, across the song
}

/**
 * Re-time the event at `fromBeats` so it spans `startBeats..endBeats`.
 *
 * A placement has no length, so this is not one edit to one file: the extent belongs to the
 * MATERIAL, and what changes is its `from`/`to` (plus `loop`, when the event repeats). The
 * placement's own `start` moves only when the left edge did.
 *
 * Returns null when there is no such event. The report names what was touched because a
 * window is shared by every placement of that material — see docs/clipResize.md.
 */
export function resizeTrackPlacement(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  startBeats: number,
  endBeats: number,
  tempo: number,
): ResizeReport | null {
  const own = entityFileFor(join(dir, "tracks"), "tracks", id);
  if (!own) throw new Error(`track "${id}" has no file in tracks/`);
  const text = readFileSync(own.path, "utf8");
  const at = findPlacementAt(text, fromBeats, num, den);
  if (at < 0) return null;
  const placement = placementValues(text)[at] ?? {};
  const ref = String(placement.ref ?? "");
  const found = materialFor(dir, ref);
  if (!found)
    throw new Error(
      `'${ref}' is neither a clip nor a sequence in this project`,
    );
  const { kind, file } = found;

  // As authored: a timecode window is read the same way the compiler reads it, so a resize
  // of a file spelled that way lands on the same numbers rather than a beat off.
  const win = materialWindowOf(file.path);
  const edge = (v: WindowValue | undefined): number | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === "number") return v;
    const beats = parsePosition(v, num, den);
    return kind === "sequence" ? beats : (beats * 60) / tempo;
  };
  const next = resizeToWindow(
    {
      kind,
      from: edge(win.from) ?? 0,
      to: edge(win.to),
      loops: Math.max(1, Math.floor(Number(placement.loop ?? 1)) || 1),
      startBeats: fromBeats,
    },
    { startBeats, endBeats, tempo },
  );

  // The material first: it is what carries the extent, so a reload landing between the two
  // writes shows the new length at the old position rather than an event of length zero.
  // 0 whatever the kind, so an untrimmed material keeps saying nothing rather than gaining a
  // `from: "1:1"` that only restates the default (setMaterialWindow deletes on 0).
  setMaterialWindow(
    file.path,
    next.from === 0
      ? 0
      : kind === "sequence"
        ? beatsToPosition(next.from, num, den)
        : next.from,
    kind === "sequence" ? beatsToPosition(next.to, num, den) : next.to,
  );
  editTrackStruct(
    dir,
    id,
    (t) => {
      const i = findPlacementAt(t, fromBeats, num, den);
      if (i < 0) return t;
      const withStart =
        Math.abs(next.startBeats - fromBeats) > 1e-6
          ? setPlacementField(
              t,
              i,
              "start",
              beatsToPosition(next.startBeats, num, den),
            )
          : t;
      // `loop: 1` is the default and is cleared rather than written, like every other absent field.
      return setPlacementField(
        withStart,
        i,
        "loop",
        next.loops > 1 ? next.loops : undefined,
      );
    },
    "resize a clip",
  );
  return {
    ref,
    material: file.rel,
    kind,
    loops: next.loops,
    sharedWith: sharedWith(dir, ref),
  };
}

/** How many OTHER placements name `ref` — what else this window edit just changed.
 *  Off the files' own text, for the reason placementValues gives: counting must not depend
 *  on every track in the song being schema-valid. */
function sharedWith(dir: string, ref: string): number {
  let n = -1; // the placement being resized is one of them
  for (const { file } of entityFiles(join(dir, "tracks"), "tracks")) {
    let text: string;
    try {
      text = readFileSync(file.path, "utf8");
    } catch {
      continue;
    }
    for (const p of placementValues(text)) if (String(p.ref ?? "") === ref) n++;
  }
  return Math.max(0, n);
}

/** Where a placement's material lives — `clips/<ref>` or `sequences/<ref>`, whichever exists. */
function materialFor(
  dir: string,
  ref: string,
): { kind: MaterialKind; file: { path: string; rel: string } } | null {
  const clip = entityFileFor(join(dir, "clips"), "clips", ref);
  if (clip) return { kind: "audio", file: clip };
  const seq = entityFileFor(join(dir, "sequences"), "sequences", ref);
  if (seq) return { kind: "sequence", file: seq };
  return null;
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
