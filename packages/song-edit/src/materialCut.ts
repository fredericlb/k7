// materialCut.ts — cutting and merging MATERIAL, where trackMix.ts moves and resizes PLACEMENTS.
// `event split` writes two sequences, or two windowed placements of one audio source with nothing
// rendered; `selection consolidate` writes one sequence over a range, while on audio it needs a
// render and lives with the bounce (@studio/audio-passes' processChain.ts).
// Full rationale: docs/materialCut.md.

import { join } from "node:path";
import { K7Document } from "@studio/k7x/document";
import { laneFileFor, laneFolder } from "@studio/song/chainItemEdit";
import {
  materialWindowOf,
  type WindowValue,
} from "@studio/song/yaml/materialFile";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { wsData, wsText, wsWriteData } from "@studio/song/yaml/workspaceDoc";
import { beatsToPosition, parsePosition } from "@studio/song-schema/timecode";
import type { NoteIn } from "@studio/song-schema/yaml/sequenceFile";
import {
  addPlacement,
  copyPlacementAt,
  findPlacementAt,
  placementValues,
  removePlacementAt,
  setPlacementField,
} from "@studio/song-schema/yaml/trackFile";
import { editTrackStruct } from "./trackMix";

/** Two placements at the same beat are the same placement, so this is what "the same" means. */
const EDGE_EPS = 1e-6;

/** One material this wrote: what it is called, where it landed, and how much is in it. */
interface WrittenMaterial {
  ref: string;
  /** Project-relative POSIX path — for the log, so a person can go and open it. */
  file: string;
  notes: number;
}

export interface PhysicalSplitReport {
  head: WrittenMaterial;
  tail: WrittenMaterial;
  /** The material that was cut. Left on disk untouched — another lane may still play it. */
  from: string;
}

export interface ConsolidateReport {
  written: WrittenMaterial;
  /** How many placements became the one. */
  replaced: number;
  /** The materials it drew on, in the order they played. */
  from: string[];
}

/** A free name under `sequences/` — the number keeps climbing, so nothing is overwritten. */
function freeSequenceName(
  dir: string,
  base: string,
  taken: Set<string>,
): string {
  for (let n = 1; ; n++) {
    const name = `${base}-${n}`;
    if (
      !taken.has(name) &&
      !entityFileFor(join(dir, "sequences"), "sequences", name)
    ) {
      taken.add(name);
      return name;
    }
  }
}

/** The notes a sequence file holds, its short form expanded; anything unreadable is no notes at all, and the compile says so. */
function notesOf(file: string): NoteIn[] {
  try {
    const raw = wsData(file) as { notes?: unknown };
    if (!Array.isArray(raw?.notes)) return [];
    return raw.notes
      .map((n) => n as Partial<NoteIn>)
      .filter(
        (n): n is NoteIn =>
          Number.isFinite(n.t) && Number.isFinite(n.d) && Number.isFinite(n.k),
      )
      .map((n) => ({
        t: n.t,
        d: n.d,
        k: n.k,
        ...(n.v === undefined ? {} : { v: n.v }),
      }));
  } catch {
    return [];
  }
}

/** The notes sounding inside `[from, to)`, rebased to beat 0; a straddling note is TRUNCATED. */
function notesIn(notes: NoteIn[], from: number, to: number): NoteIn[] {
  const out: NoteIn[] = [];
  for (const n of notes) {
    const start = Math.max(n.t, from);
    const end = Math.min(n.t + n.d, to);
    if (end - start <= EDGE_EPS) continue;
    out.push({ ...n, t: start - from, d: end - start });
  }
  return out.sort((a, b) => a.t - b.t || a.k - b.k);
}

/** Write `sequences/<ref>.k7x` — which edges it declares differs by verb, see docs/materialCut.md. */
function writeSequence(
  dir: string,
  ref: string,
  notes: NoteIn[],
  window: { from?: number; to: number; verb: string } | null,
  num: number,
  den: number,
): WrittenMaterial {
  const rel = `sequences/${ref}.k7x`;
  const data: Record<string, unknown> = {};
  // Both edges are POSITIONS, read the way a placement's window is.
  if (window?.from != null) data.from = beatsToPosition(window.from, num, den);
  if (window && window.to > EDGE_EPS)
    data.to = beatsToPosition(window.to, num, den);
  data.notes = notes.map((n) => ({
    t: +n.t.toFixed(6),
    d: +n.d.toFixed(6),
    k: n.k,
    ...(n.v === undefined ? {} : { v: n.v }),
  }));
  wsWriteData(join(dir, rel), data, {
    header: [`Written by \`${window?.verb ?? "selection consolidate"}\`.`],
  });
  return { ref, file: rel, notes: notes.length };
}

/** The window a placement of `ref` actually plays, in the material's own beats. */
function windowOf(
  dir: string,
  ref: string,
  placement: Record<string, unknown>,
  num: number,
  den: number,
): { from: number; to?: number } {
  const file = entityFileFor(join(dir, "sequences"), "sequences", ref);
  const pos = (v: WindowValue | undefined): number | undefined =>
    v === undefined ? undefined : parsePosition(String(v), num, den);
  const mat = file ? materialWindowOf(file.path) : {};
  const raw = (v: unknown): WindowValue | undefined =>
    typeof v === "number" || typeof v === "string" ? v : undefined;
  const mFrom = pos(mat.from) ?? 0;
  const mTo = pos(mat.to);
  const pFrom = pos(raw(placement.from));
  const pTo = pos(raw(placement.to));
  // The most restrictive edge wins — the same rule the compiler applies (nodeProject.ts).
  const from = Math.max(mFrom, pFrom ?? 0);
  const to = mTo != null && pTo != null ? Math.min(mTo, pTo) : (mTo ?? pTo);
  return { from, ...(to != null ? { to } : {}) };
}

/** Cut a SEQUENCE placement's material in two at `atBeats` and play the halves — docs/materialCut.md. */
export function splitSequenceMaterial(
  dir: string,
  trackId: string,
  fromBeats: number,
  atBeats: number,
  num: number,
  den: number,
): PhysicalSplitReport | null {
  const own = laneFileFor(dir, trackId);
  if (!own)
    throw new Error(`track "${trackId}" has no file in ${laneFolder(dir)}/`);
  const lane = new K7Document(wsText(own.path)).at([]);
  const index = findPlacementAt(lane, fromBeats, num, den);
  if (index < 0) return null;
  const placement = placementValues(lane)[index] ?? {};
  const ref = String(placement.ref ?? "");
  const file = entityFileFor(join(dir, "sequences"), "sequences", ref);
  if (!file)
    throw new Error(
      `'${ref}' is not a sequence in this project — an audio split is two windowed placements, splitAudioPlacement`,
    );
  const loops = Math.max(1, Math.floor(Number(placement.loop ?? 1)) || 1);
  if (loops > 1)
    throw new Error(
      `'${ref}' repeats ${loops} times here — set its loop back to 1 before splitting it`,
    );

  const win = windowOf(dir, ref, placement, num, den);
  const cut = win.from + (atBeats - fromBeats);
  if (!(atBeats > fromBeats + EDGE_EPS))
    throw new Error("the cut has to be after the event starts");
  if (win.to != null && cut >= win.to - EDGE_EPS)
    throw new Error("the cut has to be before the event ends");

  const all = notesOf(file.path);
  const end = win.to ?? Math.max(win.from, ...all.map((n) => n.t + n.d), cut);
  const taken = new Set<string>();
  const head = writeSequence(
    dir,
    freeSequenceName(dir, ref, taken),
    notesIn(all, win.from, cut),
    { to: cut - win.from, verb: "event split" },
    num,
    den,
  );
  const tail = writeSequence(
    dir,
    freeSequenceName(dir, ref, taken),
    notesIn(all, cut, end),
    { to: end - cut, verb: "event split" },
    num,
    den,
  );

  // ONE write for both halves: a file caught between them would play the head twice.
  editTrackStruct(
    dir,
    trackId,
    (doc) => {
      const i = findPlacementAt(doc, fromBeats, num, den);
      if (i < 0) return;
      // Every window on the placement is cleared: both halves are whole materials.
      setPlacementField(doc, i, "ref", head.ref);
      setPlacementField(doc, i, "from", undefined);
      setPlacementField(doc, i, "to", undefined);
      copyPlacementAt(doc, i, {
        ref: tail.ref,
        start: beatsToPosition(atBeats, num, den),
        from: undefined,
        to: undefined,
      });
    },
    "split an event's material",
  );
  return { head, tail, from: ref };
}

/** Write ONE sequence over `[fromBeats, toBeats]`, gaps kept — see docs/materialCut.md. */
export function consolidateSequenceMaterial(
  dir: string,
  trackId: string,
  fromBeats: number,
  toBeats: number,
  num: number,
  den: number,
): ConsolidateReport | null {
  const own = laneFileFor(dir, trackId);
  if (!own)
    throw new Error(`track "${trackId}" has no file in ${laneFolder(dir)}/`);
  const lane = new K7Document(wsText(own.path)).at([]);

  const startOf = (p: Record<string, unknown>): number | null => {
    try {
      return parsePosition(String(p.start ?? "1:1:1"), num, den);
    } catch {
      return null;
    }
  };
  const picked = placementValues(lane)
    .map((p, index) => ({ p, index, start: startOf(p) }))
    .filter(
      (e): e is { p: Record<string, unknown>; index: number; start: number } =>
        e.start !== null &&
        e.start >= fromBeats - EDGE_EPS &&
        e.start <= toBeats + EDGE_EPS,
    )
    .sort((a, b) => a.start - b.start);
  if (!picked.length) return null;

  const notes: NoteIn[] = [];
  const from: string[] = [];
  for (const { p, start } of picked) {
    const ref = String(p.ref ?? "");
    const file = entityFileFor(join(dir, "sequences"), "sequences", ref);
    if (!file)
      throw new Error(
        `'${ref}' is not a sequence — consolidating audio renders a new file, which is @studio/commands' half`,
      );
    from.push(ref);
    const win = windowOf(dir, ref, p, num, den);
    const all = notesOf(file.path);
    const end = win.to ?? Math.max(win.from, ...all.map((n) => n.t + n.d));
    const loops = Math.max(1, Math.floor(Number(p.loop ?? 1)) || 1);
    const span = end - win.from;
    // A repeat is UNROLLED rather than refused: N copies of one window laid end to end.
    for (let pass = 0; pass < loops; pass++)
      for (const n of notesIn(all, win.from, end))
        notes.push({ ...n, t: n.t + (start - fromBeats) + pass * span });
  }

  const ordered = notes.sort((a, b) => a.t - b.t || a.k - b.k);
  // The declared window is the RECTANGLE, never narrowed below what it holds — docs/materialCut.md.
  const lastNote = ordered.reduce((end, n) => Math.max(end, n.t + n.d), 0);
  const taken = new Set<string>();
  const written = writeSequence(
    dir,
    freeSequenceName(dir, trackId, taken),
    ordered,
    {
      from: 0,
      to: Math.max(toBeats - fromBeats, lastNote),
      verb: "selection consolidate",
    },
    num,
    den,
  );

  // Highest index first, so removing one does not renumber the next.
  editTrackStruct(
    dir,
    trackId,
    (doc) => {
      for (const { start } of [...picked].reverse()) {
        const i = findPlacementAt(doc, start, num, den);
        if (i >= 0) removePlacementAt(doc, i);
      }
      addPlacement(doc, {
        ref: written.ref,
        start: beatsToPosition(fromBeats, num, den),
      });
    },
    "consolidate a range",
  );
  return { written, replaced: picked.length, from };
}

/** What an audio split wrote: the cut, in seconds of the source both halves still play. */
export interface PlacementSplitReport {
  cut: number;
}

/** Cut an AUDIO placement in two WITHOUT a render: two placements of one source, windowed either side of the cut — docs/materialCut.md. */
export function splitAudioPlacement(
  dir: string,
  trackId: string,
  fromBeats: number,
  atBeats: number,
  num: number,
  den: number,
  cut: number,
): PlacementSplitReport | null {
  // Four decimals, as a resize writes a window: a split must not leave a hair of float noise in the file.
  const at = Math.round(cut * 10000) / 10000;
  let found = false;
  editTrackStruct(
    dir,
    trackId,
    (doc) => {
      const i = findPlacementAt(doc, fromBeats, num, den);
      if (i < 0) return;
      found = true;
      // The tail: the same placement from the cut on, keeping the end and the fade-out, losing the fade-in.
      copyPlacementAt(doc, i, {
        start: beatsToPosition(atBeats, num, den),
        from: at,
        fadeIn: undefined,
      });
      // The head ends at the cut and loses the fade-out the tail now has.
      setPlacementField(doc, i, "to", at);
      setPlacementField(doc, i, "fadeOut", undefined);
    },
    "split an event",
  );
  return found ? { cut: at } : null;
}
