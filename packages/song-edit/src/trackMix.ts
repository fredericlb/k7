// trackMix.ts — mixer mutations: set a track's scalar fields (volume/pan/mute/solo) by
// rewriting its file in place, so the change round-trips the same way for every surface
// (TUI watcher, web refetch) that reloads it. A surgical edit, not a re-serialization.

import { join } from "node:path";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import { laneFileFor, laneFolder } from "@studio/song/chainItemEdit";
import {
  materialWindowOf,
  type WindowValue,
} from "@studio/song/yaml/materialFile";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { wsEdit, wsText } from "@studio/song/yaml/workspaceDoc";
import {
  beatsToDuration,
  beatsToPosition,
  parsePosition,
} from "@studio/song-schema/timecode";
import type { Placement } from "@studio/song-schema/yaml/placementSchema";
import { shiftTakes, shiftTakesAt } from "@studio/song-schema/yaml/takeFile";
import {
  addPlacement,
  findPlacementAt,
  movePlacementAt,
  placementAt,
  placementValues,
  removePlacementAt,
  setPlacementField,
} from "@studio/song-schema/yaml/trackFile";
import { type MaterialKind, resizeToWindow } from "./clipResize";

// --- gain / pan conversions: a track's `volume` is a LINEAR GAIN, not dB (1.0 == unity) ----

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

// --- writing a track's file: a placement is addressed by its POSITION IN BEATS, docs/trackMix.md ---

/** Edit lane `id`'s file in place through `edit` on its root; throws when the lane has no file (`what` names the edit in the message). */
export function editTrackStruct(
  dir: string,
  id: string,
  edit: (doc: K7Scope) => void,
  what: string,
): string {
  // `nodes/` (or a chain project's `tracks/`), because a lane IS a node of a `@meta/…-track` module.
  const found = laneFileFor(dir, id);
  if (!found)
    throw new Error(
      `track "${id}" has no file in ${laneFolder(dir)}/ — cannot ${what}`,
    );
  wsEdit(found.path, (doc) => edit(doc.at([])));
  return found.path;
}

// Move a placement to ANOTHER lane's file, carried over WHOLE and cut first — docs/trackMix.md.
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
    (doc) => {
      const at = findPlacementAt(doc, fromBeats, num, den);
      if (at < 0) return;
      cut = placementAt(doc, at);
      if (cut) removePlacementAt(doc, at);
    },
    `move a placement off track "${fromId}"`,
  );
  if (!cut) return false;

  editTrackStruct(
    dir,
    toId,
    (doc) =>
      addPlacement(doc, {
        // Its takes were played where the event was: they travel with it (song docs/takes.md).
        ...shiftTakes(
          cut as Record<string, unknown>,
          parsePosition(toTc, num, den) - fromBeats,
          num,
          den,
        ),
        start: toTc,
      } as never),
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
    (doc) => {
      const at = findPlacementAt(doc, fromBeats, num, den);
      if (at < 0) return;
      moved = true;
      movePlacementAt(doc, at, toTc);
      // Its takes, comp and crossfades move with it — they are song positions (song docs/takes.md).
      shiftTakesAt(
        doc,
        at,
        parsePosition(toTc, num, den) - fromBeats,
        num,
        den,
      );
    },
    "move a clip",
  );
  return moved;
}

/** Move every placement starting in [fromBeats, toBeats] by `deltaBeats`, in one rewrite — docs/trackMix.md. */
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
    (doc) => {
      const starts = placementValues(doc).map((p) => {
        try {
          return parsePosition(String(p.start ?? "1:1:1"), num, den);
        } catch {
          return null; // an unparseable start can't fall in any range
        }
      });
      starts.forEach((s, i) => {
        if (s === null || s < fromBeats - 1e-6 || s > toBeats + 1e-6) return;
        // By index, not by position: indices are stable under a start rewrite.
        movePlacementAt(doc, i, beatsToPosition(s + deltaBeats, num, den));
        shiftTakesAt(doc, i, deltaBeats, num, den);
        moved++;
      });
    },
    "move the events in a range",
  );
  return moved;
}

/** Write one field of the placement at `fromBeats`; `undefined` DELETES, which is how a caller says "default". */
function setPlacementFieldAt(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  key: string,
  // Widened from `boolean` for the fades, which write a timecode.
  value: string | number | boolean | undefined,
  what: string,
): boolean {
  let hit = false;
  editTrackStruct(
    dir,
    id,
    (doc) => {
      const at = findPlacementAt(doc, fromBeats, num, den);
      if (at < 0) return;
      hit = true;
      setPlacementField(doc, at, key, value);
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

/** Whether the placement at `fromBeats` plays the material's stretch map — polarity inverted, docs/trackMix.md. */
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

/** How long the placement at `fromBeats` fades, in beats; zero deletes and a fade is a DURATION, docs/trackMix.md. */
export function setTrackPlacementFade(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  which: "fadeIn" | "fadeOut",
  beats: number,
): boolean {
  return setPlacementFieldAt(
    dir,
    id,
    fromBeats,
    num,
    den,
    which,
    beats > 0 ? beatsToDuration(beats, num, den) : undefined,
    "set an event's fade",
  );
}

/** Which slice of its material the placement at `fromBeats` plays — its `from`/`to`, in SECONDS; docs/trackMix.md. */
export function setTrackPlacementWindow(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  win: { from: number; to: number },
  dur = 0,
): boolean {
  const tidy = (s: number) => Math.round(s * 10000) / 10000;
  const from = win.from > 1e-4 ? tidy(win.from) : undefined;
  const to = dur > 0 && win.to >= dur - 1e-4 ? undefined : tidy(win.to);
  const set = (field: "from" | "to", v: number | undefined) =>
    setPlacementFieldAt(
      dir,
      id,
      fromBeats,
      num,
      den,
      field,
      v,
      "set an event's window",
    );
  // Both, always: an edge the drag decided against has to go, or it narrows what the other opened.
  const a = set("from", from);
  const b = set("to", to);
  return a || b;
}

/** What a resize touched — ONE event, since the window it writes is the placement's own. */
export interface ResizeReport {
  ref: string; // the material the event plays
  material: string; // its project-relative path
  kind: MaterialKind;
  loops: number; // the pass count afterwards
}

// Close enough for a window edge: seconds are tidied to 1e-6 and beats are exact fractions.
const EDGE_EPS = 1e-6;

/** Re-time the event at `fromBeats` to span `startBeats..endBeats`, or null when there is none — docs/trackMix.md. */
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
  const own = laneFileFor(dir, id);
  if (!own) throw new Error(`track "${id}" has no file in ${laneFolder(dir)}/`);
  const lane = new K7Document(wsText(own.path)).at([]);
  const at = findPlacementAt(lane, fromBeats, num, den);
  if (at < 0) return null;
  const placement = placementValues(lane)[at] ?? {};
  const ref = String(placement.ref ?? "");
  const found = materialFor(dir, ref);
  if (!found)
    throw new Error(
      `'${ref}' is neither a clip nor a sequence in this project`,
    );
  const { kind, file } = found;

  // As authored: a timecode window is read the way the compiler reads it, to the same numbers.
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
    (doc) => {
      const i = findPlacementAt(doc, fromBeats, num, den);
      if (i < 0) return;
      if (Math.abs(next.startBeats - fromBeats) > 1e-6)
        setPlacementField(
          doc,
          i,
          "start",
          beatsToPosition(next.startBeats, num, den),
        );
      // `loop: 1` is the default and is cleared rather than written, like every other absent field.
      setPlacementField(
        doc,
        i,
        "loop",
        next.loops > 1 ? next.loops : undefined,
      );
      // A looped event's window does not move — its from/to stay as authored.
      if (next.loops <= 1) {
        setPlacementField(
          doc,
          i,
          "from",
          next.from > matFrom + EDGE_EPS ? fmt(next.from) : undefined,
        );
        // Cleared on the material's own `to`, but kept when the material states none at all.
        setPlacementField(
          doc,
          i,
          "to",
          matTo != null && next.to >= matTo - EDGE_EPS
            ? undefined
            : fmt(next.to),
        );
      }
    },
    "resize a clip",
  );
  return { ref, material: file.rel, kind, loops: next.loops };
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

/** Put `ref` on lane `id` at `start` — a REFERENCE, landing on the set the lane is PLAYING; docs/trackMix.md. */
export function addTrackPlacement(
  dir: string,
  id: string,
  ref: string,
  start: string,
): string {
  return editTrackStruct(
    dir,
    id,
    (doc) => addPlacement(doc, { ref, start }),
    `put "${ref}" on track "${id}"`,
  );
}

/** Put SEVERAL placements on one lane in ONE rewrite — atomic, and in the caller's order; docs/trackMix.md. */
export function addTrackPlacements(
  dir: string,
  id: string,
  // A WHOLE placement and not just where it goes, already schema-checked by the caller.
  placements: Placement[],
): string {
  return editTrackStruct(
    dir,
    id,
    (doc) => {
      for (const p of placements) addPlacement(doc, p);
    },
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
    (doc) => {
      const at = findPlacementAt(doc, fromBeats, num, den);
      if (at < 0) return;
      removed = true;
      removePlacementAt(doc, at);
    },
    "remove a clip",
  );
  return removed;
}
