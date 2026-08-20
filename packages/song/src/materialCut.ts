// materialCut.ts — cutting and merging MATERIAL, where trackMix.ts moves and resizes PLACEMENTS.
// `event split` writes two sequences, `selection consolidate` writes one over a range. Sequences only: notes are text this package reads
// and writes, while the same verbs on audio need a render and live with the bounce
// (@studio/commands' processChain.ts). Full rationale: docs/materialCut.md.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { beatsToPosition, parsePosition } from "./timecode";
import { editTrackStruct } from "./trackMix";
import { materialWindowOf, type WindowValue } from "./yaml/materialFile";
import { entityFileFor } from "./yaml/moduleIO";
import type { NoteIn } from "./yaml/sequenceFile";
import {
  addPlacement,
  copyPlacementAt,
  findPlacementAt,
  placementValues,
  removePlacementAt,
  setPlacementField,
} from "./yaml/trackFile";

/** Two placements at the same beat are the same placement, so this is what "the same" means. */
const EDGE_EPS = 1e-6;

/** One material this wrote: what it is called, where it landed, and how much is in it. */
export interface WrittenMaterial {
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

/**
 * A free name under `sequences/`, from `base`.
 *
 * `base-1`, `base-2`, … and the number keeps climbing past anything already there — the same
 * uniquifying every other writer here does (`moduleFork`, the recycle bin, an import). A split
 * run twice therefore leaves four sequences rather than overwriting the first pair, which is
 * the right default for a verb whose whole point is that it WRITES material.
 */
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

/** The notes a sequence file holds, as plain values. Anything unreadable is no notes at all —
 *  the compile reports a malformed sequence, and this verb must not be the surface that raises it. */
function notesOf(file: string): NoteIn[] {
  try {
    const doc = parseDocument(readFileSync(file, "utf8"), { version: "1.2" });
    const raw = doc.toJS() as { notes?: unknown };
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

/**
 * The notes that sound inside `[from, to)`, moved so the window's start is beat 0.
 *
 * A note STRADDLING an edge is truncated rather than dropped: the cut is a moment in time, and
 * what was sounding at that moment goes on sounding up to it. Dropping it would make the halves
 * play something the whole never did, which is the one thing a split may not do.
 */
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

/**
 * Write `sequences/<ref>.yaml`.
 *
 * `extentBeats` fixes the extent with a `to:`, and only a SPLIT passes one: its halves are cut to
 * the cut, so their notes can never run past it, and a head whose last note stops early still has
 * to end where the knife fell.
 *
 * A CONSOLIDATION passes null, and that is the correction this whole function carries. It used to
 * write the rectangle's span, which read as "the new material ends here" while the notes were
 * copied whole — so a selected event playing past the rectangle put notes AFTER the extent, and
 * nothing played them. Present in the file, silent: the worst shape a bug takes. A consolidated
 * material IS its notes, so it declares no window at all.
 */
function writeSequence(
  dir: string,
  ref: string,
  notes: NoteIn[],
  window: { from?: number; to: number; verb: string } | null,
  num: number,
  den: number,
): WrittenMaterial {
  const rel = `sequences/${ref}.yaml`;
  const lines = notes.map(
    (n) =>
      `  - { t: ${+n.t.toFixed(6)}, d: ${+n.d.toFixed(6)}, k: ${n.k}${
        n.v === undefined ? "" : `, v: ${n.v}`
      }` + " }",
  );
  // Both edges are POSITIONS and quoted, for the reason every timecode here is: `3:1` unquoted
  // is sexagesimal in YAML 1.1. A consolidation states BOTH -- the window IS the rectangle, said
  // in full -- while a split's half states only its `to`, since it starts at its own beat 0.
  const edges =
    window == null
      ? ""
      : (window.from != null
          ? `from: "${beatsToPosition(window.from, num, den)}"\n`
          : "") +
        (window.to > EDGE_EPS
          ? `to: "${beatsToPosition(window.to, num, den)}"\n`
          : "");
  writeFileSync(
    join(dir, rel),
    `# Written by \`${window?.verb ?? "selection consolidate"}\`.\n` +
      edges +
      `notes:\n${lines.join("\n")}${lines.length ? "\n" : ""}`,
    "utf8",
  );
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

/**
 * Cut a SEQUENCE placement's material in two at `atBeats`, and play the halves.
 *
 * The physical half of `event split`. Where the virtual one leaves two placements of one
 * material, this writes two sequences and points a placement at each — so the halves can then be
 * edited apart, which is the whole reason to want it.
 *
 * The material it cut is **left on disk**. Another placement, on another lane, may still be
 * playing it, and this verb cannot know what was meant to be kept; `sequences/` gaining a file
 * is cheap, a project that stops compiling is not.
 *
 * Answers null when no placement starts at `fromBeats` — a stale surface, not a broken file.
 */
export function splitSequenceMaterial(
  dir: string,
  trackId: string,
  fromBeats: number,
  atBeats: number,
  num: number,
  den: number,
): PhysicalSplitReport | null {
  const own = entityFileFor(join(dir, "nodes"), "nodes", trackId);
  if (!own) throw new Error(`track "${trackId}" has no file in nodes/`);
  const text = readFileSync(own.path, "utf8");
  const index = findPlacementAt(text, fromBeats, num, den);
  if (index < 0) return null;
  const placement = placementValues(text)[index] ?? {};
  const ref = String(placement.ref ?? "");
  const file = entityFileFor(join(dir, "sequences"), "sequences", ref);
  if (!file)
    throw new Error(
      `'${ref}' is not a sequence in this project — a physical split of audio renders two files, which is @studio/commands' half`,
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

  // ONE write for both halves, as the virtual split does: a file caught between them would be a
  // lane playing the head twice, or nothing at all.
  editTrackStruct(
    dir,
    trackId,
    (t) => {
      const i = findPlacementAt(t, fromBeats, num, den);
      if (i < 0) return t;
      // Both halves are whole materials now, so every window on the placement is cleared: a
      // `from`/`to` left behind would window the NEW file with the OLD file's numbers.
      let next = setPlacementField(t, i, "ref", head.ref);
      next = setPlacementField(next, i, "from", undefined);
      next = setPlacementField(next, i, "to", undefined);
      return copyPlacementAt(next, i, {
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

/**
 * Write ONE sequence over `[fromBeats, toBeats]`, holding everything that plays there.
 *
 * What `event join` refuses. Join puts a run back together only when nothing has to be written —
 * one material, no gap, each neighbour continuing the last. Every other case needs a new file,
 * and this is the verb that writes it.
 *
 * **Gaps are kept.** The new sequence spans the whole rectangle: notes land at their offset from
 * its start, and where nothing played there are simply no notes. A `to:` fixes the extent, so a
 * rectangle ending in silence still ends there — which is what makes the result play back
 * identically, the same test a split has to pass.
 *
 * Selected by where a placement STARTS, both ends inclusive — the rule `events move` and
 * `event join` already use, so one rectangle means one set of events whichever verb reads it.
 */
export function consolidateSequenceMaterial(
  dir: string,
  trackId: string,
  fromBeats: number,
  toBeats: number,
  num: number,
  den: number,
): ConsolidateReport | null {
  const own = entityFileFor(join(dir, "nodes"), "nodes", trackId);
  if (!own) throw new Error(`track "${trackId}" has no file in nodes/`);
  const text = readFileSync(own.path, "utf8");

  const startOf = (p: Record<string, unknown>): number | null => {
    try {
      return parsePosition(String(p.start ?? "1:1:1"), num, den);
    } catch {
      return null;
    }
  };
  const picked = placementValues(text)
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
    // A repeat is unrolled rather than refused: it is N copies of one window laid end to end,
    // which is exactly what the consolidated material has to contain.
    for (let pass = 0; pass < loops; pass++)
      for (const n of notesIn(all, win.from, end))
        notes.push({ ...n, t: n.t + (start - fromBeats) + pass * span });
  }

  const ordered = notes.sort((a, b) => a.t - b.t || a.k - b.k);
  /**
   * The window the new material declares: the RECTANGLE, and never less than what it holds.
   *
   * Both edges, stated in full — `from` at the rectangle's start and `to` at its end — so the
   * material says exactly what was selected. That is what keeps a gap at either end: a sequence
   * with no `to` ends where its last note does, and the trailing silence of a selection would
   * simply not be there.
   *
   * `Math.max` with the last note's end is the correction that matters, and the bug it fixes was
   * silent. The rectangle selects by where an event STARTS, so a selected event may legitimately
   * play past the right edge — and an extent taken from the rectangle alone then declared the
   * material over before its own notes. They sat in the file, after the end, and nothing played
   * them. The window may only ever be widened by what it contains, never narrowed.
   */
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
    (t) => {
      let next = t;
      for (const { start } of [...picked].reverse()) {
        const i = findPlacementAt(next, start, num, den);
        if (i >= 0) next = removePlacementAt(next, i);
      }
      return addPlacement(next, {
        ref: written.ref,
        start: beatsToPosition(fromBeats, num, den),
      });
    },
    "consolidate a range",
  );
  return { written, replaced: picked.length, from };
}
