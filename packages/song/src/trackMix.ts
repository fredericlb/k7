// trackMix.ts — mixer mutations: set a track's scalar fields (volume/pan/mute/solo) by
// rewriting its file in place, so the change round-trips the same way for every surface
// (TUI watcher, web refetch) that reloads it. A surgical edit, not a re-serialization.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type MaterialKind, resizeToWindow } from "./clipResize";
import { beatsToPosition, parsePosition } from "./timecode";
import { materialWindowOf, type WindowValue } from "./yaml/materialFile";
import { entityFileFor } from "./yaml/moduleIO";
import {
  addPlacement,
  copyPlacementAt,
  findPlacementAt,
  movePlacementAt,
  placementAt,
  placementValues,
  pushEventsToTake,
  removeAllTakes,
  removePlacementAt,
  removeTake,
  selectTake,
  setPlacementField,
  setTrackField,
  takeValues,
} from "./yaml/trackFile";

/**
 * The scalar fields a lane's own file still carries.
 *
 * `mute` and `solo` are NOT here any more, and neither is `frozen`. A lane's mute is its module's
 * bypass, written to `graph.yaml`'s `bypassed:` — one state in one place — and solo is derived by
 * the surface. `volume`/`pan` left for the `Mixer` module before any of this. See
 * docs/trackModules.md.
 */
export type TrackFields = Partial<{
  color: string;
  disabled: boolean;
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

/** Rewrite lane `id`'s file in place via `transform` on its text; throws when the lane has no file (`what` names the edit in the message). */
export function editTrackStruct(
  dir: string,
  id: string,
  transform: (text: string) => string,
  what: string,
): string {
  // `nodes/`, because that is where a lane lives: it is a node of a `@studio/…-track`
  // module, and the file names it exactly as its track file used to.
  const found = entityFileFor(join(dir, "nodes"), "nodes", id);
  if (!found)
    throw new Error(`track "${id}" has no file in nodes/ — cannot ${what}`);
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

/**
 * Move EVERY placement whose start falls in [fromBeats, toBeats] (both inclusive) by
 * `deltaBeats` — the bulk form of moveTrackPlacement: one file rewrite however many
 * events the range holds, so the whole gesture is one journal step for the caller.
 *
 * The starts are collected BEFORE any line is rewritten, which is the property a loop of
 * single moves cannot give: addressing is by position, and moving one event onto another's
 * start would shadow that event's address mid-pass. Returns how many moved; 0 writes nothing.
 */
export function moveTrackPlacementsInRange(
  dir: string,
  id: string,
  fromBeats: number,
  toBeats: number,
  deltaBeats: number,
  num: number,
  den: number,
): number {
  let moved = 0;
  editTrackStruct(
    dir,
    id,
    (text) => {
      const starts = placementValues(text).map((p) => {
        try {
          return parsePosition(String(p.start ?? "1:1:1"), num, den);
        } catch {
          return null; // an unparseable start can't fall in any range
        }
      });
      let out = text;
      starts.forEach((s, i) => {
        if (s === null || s < fromBeats - 1e-6 || s > toBeats + 1e-6) return;
        // By index, not by position: indices are stable under a start rewrite, so the
        // original starts collected above stay true addresses for the whole pass.
        out = movePlacementAt(
          out,
          i,
          beatsToPosition(s + deltaBeats, num, den),
        );
        moved++;
      });
      return out;
    },
    "move the events in a range",
  );
  return moved;
}

/**
 * Write one field of the placement at `fromBeats`. Returns true if one was there.
 *
 * `undefined` DELETES, which is how both callers below say "back to the default": switching a
 * flag off and on again leaves the file exactly as it was, rather than accumulating a
 * `disabled: false` on every event anybody ever touched.
 */
function setPlacementFieldAt(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  key: string,
  value: boolean | undefined,
  what: string,
): boolean {
  let hit = false;
  editTrackStruct(
    dir,
    id,
    (text) => {
      const at = findPlacementAt(text, fromBeats, num, den);
      if (at < 0) return text;
      hit = true;
      return setPlacementField(text, at, key, value);
    },
    what,
  );
  return hit;
}

/** Switch the placement at `fromBeats` on or off. Written when true, deleted when false. */
export function setTrackPlacementDisabled(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  disabled: boolean,
): boolean {
  return setPlacementFieldAt(
    dir,
    id,
    fromBeats,
    num,
    den,
    "disabled",
    disabled || undefined,
    "disable a clip",
  );
}

/**
 * Whether the placement at `fromBeats` plays the material's stretch map.
 *
 * The polarity is the OTHER way round from `disabled`, because the default is the other way
 * round: warping is what a warped clip does everywhere, so `false` is the written value and
 * `true` deletes the field. See PlacementSchema's `warp`.
 */
export function setTrackPlacementWarp(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  warp: boolean,
): boolean {
  return setPlacementFieldAt(
    dir,
    id,
    fromBeats,
    num,
    den,
    "warp",
    warp ? undefined : false,
    "set an event's warp",
  );
}

/** What a resize touched — ONE event, now that the window it writes is the placement's own. */
export interface ResizeReport {
  ref: string; // the material the event plays
  material: string; // its project-relative path
  kind: MaterialKind;
  loops: number; // the pass count afterwards
}

// Close enough for a window edge: seconds are tidied to 1e-6 and beats are exact fractions.
const EDGE_EPS = 1e-6;

/**
 * Re-time the event at `fromBeats` so it spans `startBeats..endBeats`.
 *
 * The edit lands on the PLACEMENT: its `start` when the left edge moved, its `loop` when the
 * event repeats, and otherwise its own `from`/`to` — the event-level window `PlacementSchema`
 * carries. The material's window is read but never written: it is the CAGE (the most
 * restrictive pair wins), so the event's window is clamped inside it, and an edge that only
 * restates the material's own is cleared rather than copied — the placement then says nothing,
 * which is what "no further restriction" should look like in the file.
 *
 * Returns null when there is no such event. See docs/clipResize.md.
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
  const own = entityFileFor(join(dir, "nodes"), "nodes", id);
  if (!own) throw new Error(`track "${id}" has no file in nodes/`);
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

  // As authored: a timecode window is read the way the compiler reads it, so a resize of a
  // file spelled that way lands on the same numbers rather than a beat off.
  const edge = (v: WindowValue | undefined): number | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === "number") return v;
    const beats = parsePosition(v, num, den);
    return kind === "sequence" ? beats : (beats * 60) / tempo;
  };
  const win = materialWindowOf(file.path);
  const matFrom = edge(win.from) ?? 0;
  const matTo = edge(win.to);
  const raw = (v: unknown): WindowValue | undefined =>
    typeof v === "number" || typeof v === "string" ? v : undefined;
  const evFrom = edge(raw(placement.from));
  const evTo = edge(raw(placement.to));

  const next = resizeToWindow(
    {
      kind,
      // The EFFECTIVE window is what the drag was aimed at — the extent on screen.
      from: Math.max(matFrom, evFrom ?? 0),
      to:
        matTo != null && evTo != null ? Math.min(matTo, evTo) : (matTo ?? evTo),
      loops: Math.max(1, Math.floor(Number(placement.loop ?? 1)) || 1),
      startBeats: fromBeats,
      bounds: { from: matFrom, ...(matTo != null ? { to: matTo } : {}) },
    },
    { startBeats, endBeats, tempo },
  );

  // One file, one write: everything a resize decides is the placement's own.
  const fmt = (u: number): WindowValue =>
    kind === "sequence" ? beatsToPosition(u, num, den) : u;
  editTrackStruct(
    dir,
    id,
    (t) => {
      const i = findPlacementAt(t, fromBeats, num, den);
      if (i < 0) return t;
      let out =
        Math.abs(next.startBeats - fromBeats) > 1e-6
          ? setPlacementField(
              t,
              i,
              "start",
              beatsToPosition(next.startBeats, num, den),
            )
          : t;
      // `loop: 1` is the default and is cleared rather than written, like every other absent field.
      out = setPlacementField(
        out,
        i,
        "loop",
        next.loops > 1 ? next.loops : undefined,
      );
      // A looped event's window did not move — its from/to stay whatever they were.
      if (next.loops <= 1) {
        out = setPlacementField(
          out,
          i,
          "from",
          next.from > matFrom + EDGE_EPS ? fmt(next.from) : undefined,
        );
        // Cleared when it lands on the material's own `to` — but when the material states
        // none, the event's `to` is the only thing that gives the extent a number, so it stays.
        out = setPlacementField(
          out,
          i,
          "to",
          matTo != null && next.to >= matTo - EDGE_EPS
            ? undefined
            : fmt(next.to),
        );
      }
      return out;
    },
    "resize a clip",
  );
  return { ref, material: file.rel, kind, loops: next.loops };
}

// `splitTrackPlacement` and `joinTrackPlacements` stood here, with their two report types.
//
// They were the VIRTUAL pair: a split that wrote nothing and left two placements of one
// material, and a join that put such a pair back. Both are gone. A split that does not write is
// a split whose halves you cannot then treat apart — which is the reason to cut one at all —
// and every case the join refused (a different material, a gap, an overlap, a restart) is a
// case `selection consolidate` writes. One verb rejoins anything now, at the cost of a file.
//
// What is left in this file is placement arithmetic that does not cut material: move, resize,
// disable, warp, add, remove. See packages/song/docs/materialCut.md.

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

/**
 * Put `ref` on lane `id` at `start`. The counterpart of removeTrackPlacement, and the same
 * asymmetry: this writes a REFERENCE, so the clip is not moved, copied or altered, and nothing
 * stops the same material sitting on two lanes.
 *
 * It lands on the set the lane is PLAYING — `addPlacement` resolves that per document, so a lane
 * running an alternative gets it where it can be heard (see docs/alternatives.md).
 */
export function addTrackPlacement(
  dir: string,
  id: string,
  ref: string,
  start: string,
): string {
  return editTrackStruct(
    dir,
    id,
    (text) => addPlacement(text, { ref, start }),
    `put "${ref}" on track "${id}"`,
  );
}

/**
 * Put SEVERAL placements on one lane, in ONE rewrite of its file.
 *
 * Not a loop over `addTrackPlacement`, and the difference is the whole reason it exists: that one
 * reads, transforms and writes per placement, so a paste of twelve events would be twelve reads
 * and twelve writes of the same file — and twelve chances to fail with half of them landed. The
 * transforms are pure text (`addPlacement`), so folding them inside one `editTrackStruct` is both
 * cheaper and atomic: either the lane's file gains all of them or it is untouched.
 *
 * Order is the caller's. They are appended as given, which is what a paste wants — the file's
 * `events:` is a list, not a sorted index, and the compiler reads positions rather than order.
 */
export function addTrackPlacements(
  dir: string,
  id: string,
  placements: { ref: string; start: string; loop?: number }[],
): string {
  return editTrackStruct(
    dir,
    id,
    (text) => placements.reduce((t, p) => addPlacement(t, p), text),
    `put ${placements.length} placement(s) on track "${id}"`,
  );
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

// --- takes ------------------------------------------------------------------------------
// The lane-level face of trackFile's three writers, on the same terms every other mutation
// here uses: a lane by its id, resolved to `nodes/<id>.yaml`. See docs/takes.md.

/**
 * Set aside what lane `id` is playing, as a new take. Returns true if there was anything to
 * set aside — recording onto an empty lane is not recording OVER anything.
 */
export function pushTrackClipsToTake(
  dir: string,
  id: string,
  name?: string,
): boolean {
  let pushed = false;
  editTrackStruct(
    dir,
    id,
    (text) => {
      const next = pushEventsToTake(text, name);
      pushed = next !== text;
      return next;
    },
    `set aside track "${id}"'s clips`,
  );
  return pushed;
}

/** Swap take `n` (1-based) with what lane `id` is playing. Throws if there is no take `n`. */
export function selectTrackTake(dir: string, id: string, n: number): string {
  return editTrackStruct(
    dir,
    id,
    (text) => selectTake(text, n),
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

// A lane's ALTERNATIVES lived here. They belong to the MODULE a lane is now, so the verbs are
// `node alternative …` (projectEdit.ts) and which clip list an edit above lands in is
// yaml/trackFile.ts's `clipsToEdit`. See docs/alternatives.md.
