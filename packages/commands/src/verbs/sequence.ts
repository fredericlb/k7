// sequence.ts — MIDI sequences and their single notes: create, list, add, move, split,
// remove, double. Exports the note-name parser the completions read. See docs/verbs.md.

import { join } from "node:path";
import { createSequenceFile } from "@studio/song/loader";
import type { ClipDoc, ProjectDoc } from "@studio/song/project";
import { wsRead, wsWrite } from "@studio/song/yaml/workspaceFile";
import { halveLoopsOf } from "@studio/song-edit/sequenceLoops";
import {
  appendNotes,
  doubleSequence,
  moveNote,
  removeNote,
  setNoteTimeRange,
  splitNote,
} from "@studio/song-schema/yaml/sequenceFile";
import type { CommandHost, SidHandler } from "../commands.ts";
import { uniqueId } from "./shared.ts";

export interface Sequence {
  name: string;
  trackId: string;
  clipId: string;
  clip: ClipDoc;
}

export function collectSequences(project: ProjectDoc): Sequence[] {
  const out: Sequence[] = [];
  for (const t of project.tracks)
    for (const c of t.clips)
      if (c.type === "midi")
        out.push({
          name: c.name || c.id || `${t.id}:seq`,
          trackId: t.id,
          clipId: c.id,
          clip: c,
        });
  return out;
}

// A note as a name ("C4", "F#3") or a MIDI number, 60 == C4; null on anything unparseable or outside 0..127.
export function parseMidiNote(s: string): number | null {
  const t = s.trim();
  if (/^\d+$/.test(t)) {
    const k = Number(t);
    return k >= 0 && k <= 127 ? k : null;
  }
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(t);
  if (!m) return null;
  const pc: Record<string, number> = {
    c: 0,
    d: 2,
    e: 4,
    f: 5,
    g: 7,
    a: 9,
    b: 11,
  };
  let k = (Number(m[3]) + 1) * 12 + pc[m[1].toLowerCase()];
  if (m[2] === "#") k += 1;
  else if (m[2] === "b") k -= 1;
  return k >= 0 && k <= 127 ? k : null;
}

// A beat value for a note struct, 6 decimals max, mirroring the tracker so drags don't churn the file.
export const fmtBeat = (v: number) => String(Math.round(v * 1e6) / 1e6);

// `sequence new [name]` — four empty bars to write into. Place it on a lane with `event new`.
async function newSequence(arg: string, h: CommandHost): Promise<void> {
  const name = arg.trim().split(/\s+/)[0] ?? "";
  const id = name || uniqueId("seq", h.project());
  try {
    const written = createSequenceFile(h.songPath, id);
    h.reload();
    h.log([`+ sequence ${id} (${written.join(", ")})`]);
  } catch (e) {
    h.refuse([`sequence new: ${(e as Error).message}`]);
  }
}

export const SEQUENCE_VERBS: Record<string, SidHandler> = {
  "sequence.new": async (a, h) => newSequence(a, h),
  "sequence.list": (_a, h) => {
    const seqs = collectSequences(h.project());
    if (!seqs.length) h.log(["no sequences — add one with: sequence new"]);
    else
      h.log(
        seqs.map(
          (s) =>
            `  ${s.name}  (${s.trackId}, ${s.clip.notes.length} notes, ${s.clip.length} beats)`,
        ),
      );
  },
  // Add one MIDI note: `note` is a name or number, start/end are beats, and onsets clamp to >= 0 (#Note forbids < 0).
  "sequence.addNote": async (arg, h) => {
    const [seqId, noteStr, startStr, endStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined) {
      h.refuse(["usage: sequence note new <sequence> <note> <start> [end]"]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Math.max(0, Number(startStr));
    const end = endStr !== undefined ? Number(endStr) : t + 1;
    if (!Number.isFinite(t) || !Number.isFinite(end)) {
      h.refuse(["start/end must be numbers (beats)"]);
      return;
    }
    const d = end > t ? end - t : 1;
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    wsWrite(file, appendNotes(text, [{ t, d, k }]));
    h.log([
      `added ${noteStr} (k${k}) ${fmtBeat(t)}..${fmtBeat(end)} → ${seqId}`,
    ]);
    await h.reload();
  },
  /** sequence note timerange … — move a note, stretch it, or both; one verb, two grips, docs/verbs.md. */
  "sequence.noteTimeRange": async (arg, h) => {
    const [seqId, noteStr, startStr, newStartStr, newEndStr] = arg
      .trim()
      .split(/\s+/);
    if (!seqId || !noteStr || !startStr || !newStartStr || !newEndStr) {
      h.refuse([
        "usage: sequence note timerange <sequence> <note> <start> <newStart> <newEnd>",
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const [t, nt, ne] = [startStr, newStartStr, newEndStr].map(Number);
    if (![t, nt, ne].every(Number.isFinite)) {
      h.refuse(["start, newStart and newEnd must be numbers (beats)"]);
      return;
    }
    if (ne <= nt) {
      h.refuse([
        `a note has to end after it starts — ${nt} → ${ne} is nothing`,
      ]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      h.snapshot?.(file);
      wsWrite(file, setNoteTimeRange(text, k, t, nt, ne - nt));
    } catch (e) {
      h.refuse([`sequence note timerange: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${seqId}: ${noteStr} (k${k}) ${fmtBeat(t)} → ${fmtBeat(nt)}, length ${fmtBeat(ne - nt)}`,
    ]);
    await h.reload();
  },
  /** sequence note move … — the same note somewhere else, its length and velocity riding along (moveNote). */
  "sequence.moveNote": async (arg, h) => {
    const [seqId, noteStr, startStr, toStr, toStartStr] = arg
      .trim()
      .split(/\s+/);
    if (
      !seqId ||
      !noteStr ||
      startStr === undefined ||
      !toStr ||
      toStartStr === undefined
    ) {
      h.refuse([
        "usage: sequence note move <sequence> <note> <start> <newNote> <newStart>",
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    const nk = parseMidiNote(toStr);
    if (k === null || nk === null) {
      h.refuse([
        `bad note "${k === null ? noteStr : toStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    const nt = Number(toStartStr);
    if (!Number.isFinite(t) || !Number.isFinite(nt)) {
      h.refuse(["start and newStart (beats) must be numbers"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      wsWrite(file, moveNote(text, k, t, nk, nt));
    } catch (e) {
      h.refuse([`sequence note move: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${seqId}: ${noteStr} (k${k}) ${fmtBeat(t)} → ${toStr} (k${nk}) ${fmtBeat(nt)}`,
    ]);
    await h.reload();
  },
  /** sequence note split … — cut one note in two at beat `at`, its velocity riding onto both halves; docs/verbs.md. */
  "sequence.splitNote": async (arg, h) => {
    const [seqId, noteStr, startStr, atStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined || atStr === undefined) {
      h.refuse(["usage: sequence note split <sequence> <note> <start> <at>"]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const [t, at] = [startStr, atStr].map(Number);
    if (![t, at].every(Number.isFinite)) {
      h.refuse(["start and at must be numbers (beats)"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      h.snapshot?.(file);
      wsWrite(file, splitNote(text, k, t, at));
    } catch (e) {
      h.refuse([`sequence note split: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${seqId}: ${noteStr} (k${k}) split at ${fmtBeat(at)} — two notes now`,
    ]);
    await h.reload();
  },
  "sequence.removeNote": async (arg, h) => {
    const [seqId, noteStr, startStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined) {
      h.refuse(["usage: sequence note remove <sequence> <note> <start>"]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    if (!Number.isFinite(t)) {
      h.refuse(["start (beats) must be a number"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      wsWrite(file, removeNote(text, k, t));
    } catch (e) {
      h.refuse([`sequence note remove: ${(e as Error).message}`]);
      return;
    }
    h.log([`${seqId}: ${noteStr} (k${k}) at ${fmtBeat(t)} removed`]);
    await h.reload();
  },
  /** sequence double … — twice as long, playing twice; the writer is `doubleSequence`, docs/verbs.md. */
  "sequence.double": async (arg, h) => {
    const seqId = arg.trim().split(/\s+/)[0];
    if (!seqId) {
      h.refuse(["usage: sequence double <sequence>"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    // 4/4 when the doc states none: the bar is what a window rounds to, and every surface here reads it that way.
    const p = h.project();
    let next: string;
    try {
      next = doubleSequence(
        text,
        p.timeSigNumerator || 4,
        p.timeSigDenominator || 4,
      );
    } catch (e) {
      h.refuse([`sequence double: ${(e as Error).message}`]);
      return;
    }
    h.snapshot?.(file);
    wsWrite(file, next);
    // …and half as many passes wherever it is LOOPED, so four bars of it stay four bars — docs/verbs.md.
    const loops = halveLoopsOf(h.songPath, seqId, (f) => h.snapshot?.(f));
    h.log([
      `${seqId}: doubled — twice as long, its notes played twice`,
      ...(loops.halved
        ? [`${loops.halved} placement(s) now loop half as many times`]
        : []),
      // Named one by one: a placement that did NOT follow is one whose length just changed.
      ...loops.kept.map(
        (k) =>
          `${k.lane} at ${k.start} still loops ${k.loop}× and is now twice as long — ` +
          (k.why === "odd"
            ? "an odd number of passes cannot be halved"
            : "it states a window of its own, which did not grow"),
      ),
    ]);
    await h.reload();
  },
};
