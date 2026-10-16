// sequenceNotes.ts — verbs over a REGION of notes (remove, transpose, quantize, velocity,
// move), the pad effects, and recorded notes. See docs/verbs.md.

import { join } from "node:path";
import { wsRead, wsWrite } from "@studio/song/yaml/workspaceFile";
import {
  appendNotes,
  isPlayableNote,
  mapNotesInRegion,
  moveNotes,
  type NoteIn,
  type PadEffect,
  setNoteEffect,
  setNoteVelocity,
} from "@studio/song-schema/yaml/sequenceFile";
import type { SidHandler } from "../commands.ts";
import { fmtBeat, parseMidiNote } from "./sequence.ts";

/** `sequence note repeat|skip <sequence> <note> <start> <n|off>` — a PAD's two effects, one factory; docs/verbs.md. */
function padEffectCommand(effect: PadEffect): SidHandler {
  return async (arg, h) => {
    const [seqId, noteStr, startStr, nStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined || nStr === undefined) {
      h.refuse([
        `usage: sequence note ${effect} <sequence> <note> <start> <n|off>`,
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
    const t = Number(startStr);
    if (!Number.isFinite(t)) {
      h.refuse(["start must be a number of beats"]);
      return;
    }
    const off = nStr === "off";
    const n = off ? undefined : Number(nStr);
    if (n !== undefined && (!Number.isInteger(n) || n < 2)) {
      h.refuse([
        `${effect} takes a whole number of 2 or more, or "off" — not "${nStr}"`,
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
      wsWrite(file, setNoteEffect(text, k, t, effect, n));
    } catch (e) {
      h.refuse([`sequence note ${effect}: ${(e as Error).message}`]);
      return;
    }
    const said = off
      ? `${effect} off`
      : effect === "repeat"
        ? `repeated ×${n}`
        : `silent every ${n} passes`;
    h.log([`${seqId}: ${noteStr} (k${k}) at ${fmtBeat(t)} → ${said}`]);
    await h.reload();
  };
}

/**
 * The four `sequence notes …` verbs: one RECTANGLE, one document pass, one journal entry — which
 * is why they exist beside the eight that address a single note. All five arguments are parsed
 * here and only the EDIT is each verb's own. See @studio/song-schema docs/noteEdits.md.
 */
function regionCommand(
  verb: string,
  /** The trailing argument, or undefined for a verb that wants none (`remove`). */
  value: { name: string; check: (v: number) => string | null } | undefined,
  edit: (v: number) => (n: NoteIn) => NoteIn | null,
): SidHandler {
  const usage = `usage: sequence notes ${verb} <sequence> <loNote> <hiNote> <from> <to>${value ? ` <${value.name}>` : ""}`;
  return async (arg, h) => {
    const [seqId, loStr, hiStr, fromStr, toStr, vStr] = arg.trim().split(/\s+/);
    if (
      !seqId ||
      !loStr ||
      !hiStr ||
      fromStr === undefined ||
      toStr === undefined ||
      (value && vStr === undefined)
    ) {
      h.refuse([usage]);
      return;
    }
    const lo = parseMidiNote(loStr);
    const hi = parseMidiNote(hiStr);
    if (lo === null || hi === null) {
      h.refuse([
        `bad note in "${loStr} ${hiStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const from = Number(fromStr);
    const to = Number(toStr);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      h.refuse(["from/to must be numbers (beats)"]);
      return;
    }
    const v = value ? Number(vStr) : 0;
    if (value) {
      if (!Number.isFinite(v)) {
        h.refuse([`${value.name} must be a number`]);
        return;
      }
      const bad = value.check(v);
      if (bad) {
        h.refuse([bad]);
        return;
      }
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    let out: { text: string; changed: number };
    try {
      out = mapNotesInRegion(
        text,
        { loKey: Math.min(lo, hi), hiKey: Math.max(lo, hi), from, to },
        edit(v),
      );
    } catch (e) {
      h.refuse([`sequence notes ${verb}: ${(e as Error).message}`]);
      return;
    }
    // An empty rectangle is REFUSED by name, like every other note edit: silence would read as success.
    if (!out.changed) {
      h.refuse([
        `no note between ${loStr} and ${hiStr} from beat ${from} to ${to}`,
      ]);
      return;
    }
    wsWrite(file, out.text);
    h.log([`${seqId}: ${out.changed} note(s) ${verb}d`]);
    await h.reload();
  };
}

export const SEQUENCE_NOTE_VERBS: Record<string, SidHandler> = {
  "sequence.noteRepeat": padEffectCommand("repeat"),
  "sequence.noteSkip": padEffectCommand("skip"),
  "sequence.notesRemove": regionCommand("remove", undefined, () => () => null),
  /**
   * Transposing CLAMPS onto the keyboard rather than dropping what falls off it — the engine's own
   * `transpose` node does the same, and for the sharper reason: a dropped note leaves its note-off
   * behind and hangs the voice (engine/k7-runtime DspGraph.cpp). A paste, which is not an edit of notes
   * that exist, drops instead and says so.
   */
  "sequence.notesTranspose": regionCommand(
    "transpose",
    {
      name: "semitones",
      check: (v) =>
        Number.isInteger(v) ? null : "semitones must be a whole number",
    },
    (v) => (n) => ({ ...n, k: Math.max(0, Math.min(127, n.k + v)) }),
  ),
  /** Quantizing moves the ONSET and keeps the length: stretching too would be two edits under one verb. */
  "sequence.notesQuantize": regionCommand(
    "quantize",
    {
      name: "grid",
      check: (v) => (v > 0 ? null : "the grid has to be more than 0 beats"),
    },
    (v) => (n) => ({ ...n, t: Math.max(0, Math.round(n.t / v) * v) }),
  ),
  /** Absolute, and 1 CLEARS the field, so a run of notes set to full leaves a file that never mentions velocity. */
  "sequence.notesVelocity": regionCommand(
    "velocity",
    {
      name: "velocity",
      check: (v) => (v >= 0 && v <= 1 ? null : "velocity is 0..1"),
    },
    (v) => (n) => ({
      ...n,
      ...(v === 1 ? { v: undefined } : { v: Math.round(v * 100) / 100 }),
    }),
  ),
  /** sequence notes move — a dragged SELECTION: every note to its own place, one write, one Ctrl+Z (moveNotes). */
  "sequence.notesMove": async (arg, h) => {
    const usage =
      "usage: sequence notes move <sequence> <movesJSON [[note,start,newNote,newStart],…]>";
    const trimmed = arg.trim();
    const sp = trimmed.search(/\s/);
    if (sp < 0) {
      h.refuse([usage]);
      return;
    }
    const seqId = trimmed.slice(0, sp);
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed.slice(sp + 1));
    } catch (e) {
      h.refuse([`bad moves JSON: ${(e as Error).message}`]);
      return;
    }
    const isMove = (m: unknown): m is [number, number, number, number] =>
      Array.isArray(m) &&
      m.length === 4 &&
      m.every((x) => typeof x === "number" && Number.isFinite(x));
    if (!Array.isArray(raw) || !raw.length || !raw.every(isMove)) {
      h.refuse([usage]);
      return;
    }
    const moves = raw.map(([k, t, nk, nt]) => ({ k, t, nk, nt }));
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      wsWrite(file, moveNotes(text, moves));
    } catch (e) {
      h.refuse([`sequence notes move: ${(e as Error).message}`]);
      return;
    }
    h.log([`${seqId}: moved ${moves.length} note(s)`]);
    await h.reload();
  },
  /** Set ONE note's velocity, 0..1, clamped rather than refused; a velocity of 1 CLEARS the field — docs/verbs.md. */
  "sequence.noteVelocity": async (arg, h) => {
    const [seqId, noteStr, startStr, velStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined || velStr === undefined) {
      h.refuse([
        "usage: sequence note velocity <sequence> <note> <start> <velocity 0..1>",
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
    const t = Number(startStr);
    const raw = Number(velStr);
    if (!Number.isFinite(t) || !Number.isFinite(raw)) {
      h.refuse(["start (beats) and velocity (0..1) must be numbers"]);
      return;
    }
    // Two decimals: the drag reads a pixel, and a file full of 0.7333333333 is noise in a diff.
    const v = Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      wsWrite(file, setNoteVelocity(text, k, t, v === 1 ? undefined : v));
    } catch (e) {
      h.refuse([`sequence note velocity: ${(e as Error).message}`]);
      return;
    }
    h.log([`${seqId}: ${noteStr} (k${k}) at ${fmtBeat(t)} → velocity ${v}`]);
    await h.reload();
  },
  // Append a BATCH of already-timed notes — web MIDI recording's commit half, one write and one reload.
  "sequence.recordNotes": async (arg, h) => {
    const trimmed = arg.trim();
    const sp = trimmed.search(/\s/);
    if (sp < 0) {
      h.refuse(["usage: sequence note add <sequence> <notesJSON>"]);
      return;
    }
    const seqId = trimmed.slice(0, sp);
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed.slice(sp + 1));
    } catch (e) {
      h.refuse([`bad notes JSON: ${(e as Error).message}`]);
      return;
    }
    if (!Array.isArray(raw)) {
      h.refuse(["notes payload must be a JSON array of {t,d,k,v?}"]);
      return;
    }
    const notes = raw as {
      t?: number;
      d?: number;
      k?: number;
      v?: number;
      repeat?: number;
      skip?: number;
    }[];
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = wsRead(file);
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    // A pad's effects come through a PASTE, so they are checked rather than trusted — packages/song/docs/padEffects.md.
    const effect = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isInteger(v) && v >= 2 ? v : undefined;
    const playable = notes.filter(isPlayableNote).map((n) => ({
      ...n,
      t: Math.max(0, n.t),
      // A velocity of 1 is what the engine applies anyway, so writing it says nothing.
      v: typeof n.v === "number" && n.v >= 0 && n.v < 1 ? n.v : undefined,
      repeat: effect(n.repeat),
      skip: effect(n.skip),
    }));
    if (!playable.length) {
      h.refuse(["no valid notes to record"]);
      return;
    }
    wsWrite(file, appendNotes(text, playable));
    h.log([`recorded ${playable.length} note(s) → ${seqId}`]);
    await h.reload();
  },
};
