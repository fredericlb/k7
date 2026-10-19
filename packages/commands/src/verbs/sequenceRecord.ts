// sequenceRecord.ts — `sequence record <track> <notesJSON>`: a MIDI take on a lane that holds no
// sequence yet. One new sequence sized to whole bars around the notes, the notes in it, and its
// placement on the lane — one command, so the take is one undo. Notes arrive in SONG beats, the
// file stores them clip-local. See packages/commands/docs/verbs.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { K7Scope } from "@studio/k7x/document";
import { wsEdit } from "@studio/song/yaml/workspaceDoc";
import { wsExists, wsRemove } from "@studio/song/yaml/workspaceFile";
import { addTrackPlacement } from "@studio/song-edit/trackMix";
import { beatsToPosition } from "@studio/song-schema/timecode";
import {
  appendNotes,
  isPlayableNote,
  type NoteIn,
} from "@studio/song-schema/yaml/sequenceFile";
import type { CommandHost, SidHandler } from "../commands.ts";

export const SEQUENCE_RECORD_VERBS: Record<string, SidHandler> = {
  "sequence.record": sequenceRecordCommand,
};

async function sequenceRecordCommand(a: string, h: CommandHost): Promise<void> {
  const m = /^(\S+)\s+(.+)$/s.exec(a.trim());
  if (!m) {
    h.refuse(["usage: sequence record <track> <notesJSON>"]);
    return;
  }
  const p = h.project();
  const track = p.tracks.find((t) => t.id === m[1] || t.name === m[1]);
  if (!track) {
    h.refuse([`no track "${m[1]}"`]);
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(m[2]);
  } catch (e) {
    h.refuse([`bad notes JSON: ${(e as Error).message}`]);
    return;
  }
  if (!Array.isArray(raw)) {
    h.refuse(["notes payload must be a JSON array of {t,d,k,v?}"]);
    return;
  }
  try {
    const { id, at, count } = writeRecordedSequence(
      h.songPath,
      track.id,
      raw,
      p.timeSigNumerator || 4,
      p.timeSigDenominator || 4,
    );
    h.log([`recorded ${count} note(s) → ${id}, on ${track.id} at ${at}`]);
    await h.reload();
  } catch (e) {
    h.refuse([`sequence record: ${(e as Error).message}`]);
  }
}

/** The bar the first note falls in, and how many whole bars reach past the last one's end. */
export function recordWindow(
  notes: readonly NoteIn[],
  num: number,
  den: number,
): { from: number; bars: number } {
  const bar = (num * 4) / den;
  const first = Math.max(0, Math.min(...notes.map((n) => n.t)));
  const from = Math.floor(first / bar) * bar;
  const end = Math.max(...notes.map((n) => n.t + n.d));
  return { from, bars: Math.max(1, Math.ceil((end - from) / bar)) };
}

/** Write the take as `sequences/<track>-rec-<n>.k7x` and place it; returns the id and where it landed. */
export function writeRecordedSequence(
  dir: string,
  track: string,
  raw: readonly Partial<NoteIn>[],
  num: number,
  den: number,
): { id: string; at: string; count: number } {
  const notes = raw.filter(isPlayableNote);
  if (!notes.length) throw new Error("no valid notes to record");
  const { from, bars } = recordWindow(notes, num, den);
  // A track id may hold characters a sequence filename may not.
  const base = /^[A-Za-z0-9_.-]+$/.test(track) ? `${track}-rec` : "rec";
  let n = 1;
  while (wsExists(join(dir, "sequences", `${base}-${n}.k7x`))) n++;
  const id = `${base}-${n}`;
  // Rounded as the recorded sequences already on disk are: a microsecond is below anything heard.
  const round = (v: number, places: number) => Number(v.toFixed(places));
  const local = notes.map((x) => ({
    t: round(Math.max(0, x.t - from), 6),
    d: round(x.d, 6),
    k: x.k,
    // A velocity of 1 is what the engine applies anyway, so writing it says nothing.
    v:
      typeof x.v === "number" && x.v >= 0 && x.v < 1
        ? round(x.v, 4)
        : undefined,
  }));
  const file = join(dir, "sequences", `${id}.k7x`);
  mkdirSync(join(dir, "sequences"), { recursive: true });
  const seed = (doc: K7Scope) => {
    doc.setIn(["from"], "1:1");
    doc.setIn(["to"], `${bars + 1}:1`);
    appendNotes(doc, local);
  };
  wsEdit(file, (doc) => seed(doc.at([])), { create: true });
  const at = beatsToPosition(from, num, den);
  try {
    addTrackPlacement(dir, track, id, at);
  } catch (e) {
    // A sequence no lane places is a file nobody asked for: the take failed whole.
    wsRemove(file);
    throw e;
  }
  return { id, at, count: local.length };
}
