// eventLoop.ts — an event's LOOP as the clip panels edit it: switched on or off, and its two points moved.
// The points ARE the event's window (`from`/`to`), so moving them narrows what it plays — but a looped event
// keeps its length on the lane, its pass count recomputed, the way a loop brace behaves. See docs/eventLoop.md.

import { join } from "node:path";
import { laneFileFor } from "@studio/song/chainItemEdit";
import {
  materialWindowOf,
  type WindowValue,
} from "@studio/song/yaml/materialFile";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { wsRead } from "@studio/song/yaml/workspaceFile";
import { beatsToPosition, parsePosition } from "@studio/song-schema/timecode";
import {
  findPlacementAt,
  placementValues,
  setPlacementField,
} from "@studio/song-schema/yaml/trackFile";
import { parse as parseYaml } from "yaml";
import type { MaterialKind } from "./clipResize";
import { editTrackStruct } from "./trackMix";

const EDGE_EPS = 1e-6;

/** The passes a looped event starts with: one more than none, the least that is a loop at all. */
const FIRST_LOOP = 2;

/** Where an event addressed by lane and start stands: its material, its window as the compiler reads it, its passes. */
interface Placed {
  kind: MaterialKind;
  /** The material's own window — the event can only narrow it; `to` absent when the material states none. */
  matFrom: number;
  matTo?: number;
  /** The EFFECTIVE window, in the material's unit: beats into a sequence, seconds into an audio file. */
  from: number;
  to?: number;
  loops: number;
}

/** The bar-rounded end of a sequence's last note, as nodeProject.ts computes it; undefined for one with no notes. */
function sequenceExtent(
  path: string,
  num: number,
  den: number,
): number | undefined {
  const doc = parseYaml(wsRead(path)) as {
    notes?: { t?: unknown; d?: unknown }[];
  } | null;
  const ends = (Array.isArray(doc?.notes) ? doc.notes : []).map(
    (n) => Number(n.t ?? 0) + Number(n.d ?? 0),
  );
  const last = ends.filter(Number.isFinite).reduce((m, e) => Math.max(m, e), 0);
  const bar = (num * 4) / den;
  return last > 0 ? Math.ceil(last / bar) * bar : undefined;
}

function placed(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  tempo: number,
): Placed | null {
  const own = laneFileFor(dir, id);
  if (!own) throw new Error(`track "${id}" has no lane file`);
  const text = wsRead(own.path);
  const at = findPlacementAt(text, fromBeats, num, den);
  if (at < 0) return null;
  const p = placementValues(text)[at] ?? {};
  const ref = String(p.ref ?? "");
  const clip = entityFileFor(join(dir, "clips"), "clips", ref);
  const seq = clip
    ? null
    : entityFileFor(join(dir, "sequences"), "sequences", ref);
  const file = clip ?? seq;
  if (!file)
    throw new Error(
      `'${ref}' is neither a clip nor a sequence in this project`,
    );
  const kind: MaterialKind = clip ? "audio" : "sequence";
  // As authored, read the way the compiler reads it: a timecode is a position, a number seconds of a file.
  const edge = (v: unknown): number | undefined => {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return undefined;
    const beats = parsePosition(v, num, den);
    return kind === "sequence" ? beats : (beats * 60) / tempo;
  };
  const win = materialWindowOf(file.path);
  const matFrom = edge(win.from) ?? 0;
  // A sequence that states no end ends where the compiler says: its last note, rounded up to a bar.
  const matTo =
    edge(win.to) ??
    (kind === "sequence" ? sequenceExtent(file.path, num, den) : undefined);
  const evFrom = edge(p.from);
  const evTo = edge(p.to);
  const to =
    matTo != null && evTo != null ? Math.min(matTo, evTo) : (matTo ?? evTo);
  return {
    kind,
    matFrom,
    ...(matTo != null ? { matTo } : {}),
    from: Math.max(matFrom, evFrom ?? 0),
    ...(to != null ? { to } : {}),
    loops: Math.max(1, Math.floor(Number(p.loop ?? 1)) || 1),
  };
}

/** Write fields of the placement at `fromBeats` in one edit; `undefined` deletes, which is how a default is said. */
function write(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  fields: Record<string, WindowValue | undefined>,
  what: string,
): void {
  editTrackStruct(
    dir,
    id,
    (t) => {
      const i = findPlacementAt(t, fromBeats, num, den);
      if (i < 0) return t;
      let out = t;
      for (const [k, v] of Object.entries(fields))
        out = setPlacementField(out, i, k, v);
      return out;
    },
    what,
  );
}

/** Seconds, to the precision every window writer here keeps — and DOWN, so a file's length is never overshot. */
const tidySeconds = (s: number) => Math.floor(s * 10000) / 10000;

/** Switch the event's loop on (`FIRST_LOOP` passes) or off (one); `fileSeconds` gives an audio window with no end one. */
export function setTrackPlacementLoop(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  tempo: number,
  on: boolean,
  fileSeconds?: number,
): { loops: number; changed: boolean } | null {
  const p = placed(dir, id, fromBeats, num, den, tempo);
  if (!p) return null;
  if (!on) {
    if (p.loops <= 1) return { loops: 1, changed: false };
    write(
      dir,
      id,
      fromBeats,
      num,
      den,
      { loop: undefined },
      "stop an event looping",
    );
    return { loops: 1, changed: true };
  }
  if (p.loops > 1) return { loops: p.loops, changed: false };
  const fields: Record<string, WindowValue | undefined> = { loop: FIRST_LOOP };
  // A repeat needs the window's END, and an audio file states none until someone writes it (song docs/graphModel.md).
  if (p.to == null) {
    if (!(fileSeconds && fileSeconds > 0))
      throw new Error(
        "its file's length is not known, so there is no end for the loop to repeat from",
      );
    fields.to = tidySeconds(fileSeconds);
  }
  write(dir, id, fromBeats, num, den, fields, "loop an event");
  return { loops: FIRST_LOOP, changed: true };
}

/** Move the event's loop points — its window — to `from`/`to` in the material's unit, clamped to the material. */
export function setTrackPlacementLoopPoints(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  tempo: number,
  from: number,
  to: number,
): { kind: MaterialKind; from: number; to: number; loops: number } | null {
  const p = placed(dir, id, fromBeats, num, den, tempo);
  if (!p) return null;
  // The event can only narrow its material: past the material's edges, a point stops on them.
  const f = Math.max(p.matFrom, from);
  const t = p.matTo != null ? Math.min(p.matTo, to) : to;
  if (!(t - f > EDGE_EPS))
    throw new Error(
      "the loop points have to run forwards, inside the material",
    );
  const beats = (u: number) => (p.kind === "sequence" ? u : (u * tempo) / 60);
  // A looped event keeps its length on the lane: the passes are what gives, never below a loop.
  let loops = p.loops;
  if (p.loops > 1 && p.to != null) {
    const extent = beats(p.to - p.from) * p.loops;
    loops = Math.max(FIRST_LOOP, Math.round(extent / beats(t - f)));
  }
  const fmt = (u: number): WindowValue =>
    p.kind === "sequence"
      ? beatsToPosition(u, num, den)
      : Math.round(u * 10000) / 10000;
  write(
    dir,
    id,
    fromBeats,
    num,
    den,
    {
      from: f > p.matFrom + EDGE_EPS ? fmt(f) : undefined,
      // Cleared on the material's own end, but kept when the material states none: a loop needs one.
      to: p.matTo != null && t >= p.matTo - EDGE_EPS ? undefined : fmt(t),
      loop: loops > 1 ? loops : undefined,
    },
    "move an event's loop points",
  );
  return { kind: p.kind, from: f, to: t, loops };
}
