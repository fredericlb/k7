// timecodeMigrate.ts — rewrite a document's timecodes in the short `bar:beat:sub.ticks` form.
// The parser still reads the old deep colon chain, so nothing is broken by leaving them; but every
// WRITER emits the short form now, so an untouched song drifts into two spellings the moment
// anything is edited. Driven by scripts/migrateTimecodes.ts. See docs/timecode.md.

import { isScalar, parseDocument, visit } from "yaml";
import {
  beatsToDuration,
  beatsToPosition,
  parseDuration,
  parseLegacyDuration,
  parseLegacyPosition,
  parsePosition,
} from "./timecode";
import { TIMECODE } from "./yaml/placementSchema";

/**
 * Which fields hold a timecode, and whether it counts from 1 or from 0.
 *
 * A POSITION says where something sits — `start`, and a window's edges, which are positions in the
 * material, `"1:1"` being its beginning. A DURATION says how long something lasts. Reading one as
 * the other lands a whole bar out, so the pair is spelled out rather than guessed per file.
 */
export const TIMECODE_FIELDS: Record<string, "position" | "duration"> = {
  start: "position",
  fadeIn: "duration",
  fadeOut: "duration",
  from: "position",
  to: "position",
  time: "position", // a curve's breakpoints
};

export interface TimecodeChange {
  key: string;
  from: string;
  to: string;
  /** How far the short form had to round, in beats — see `driftNote` below. */
  driftBeats: number;
}

/**
 * Rewrite one document's timecodes, returning the new text and what changed.
 *
 * Edits are SPLICED by source offset rather than re-serialised: a project is hand-written YAML with
 * comments and a shape its author chose, and rewriting a whole file to change eight characters
 * would bury the migration in a diff nobody could check.
 */
export function migrateTimecodes(
  text: string,
  num: number,
  den: number,
): { text: string; changes: TimecodeChange[] } {
  const doc = parseDocument(text, { version: "1.2" });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const edits: { at: number; end: number; text: string }[] = [];
  const changes: TimecodeChange[] = [];
  visit(doc, {
    Pair(_, pair) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      const kind = TIMECODE_FIELDS[key];
      if (!kind) return;
      const v = pair.value;
      // A STRING only: `from: 0.25` on a clip is SECONDS into a file, not a timecode, and the two
      // spellings mean different things on the very same key (see AudioClipSchema).
      if (!isScalar(v) || typeof v.value !== "string" || !v.range) return;
      const old = v.value.trim();
      if (!TIMECODE.test(old)) return;
      const read =
        kind === "position" ? parseLegacyPosition : parseLegacyDuration;
      const back = kind === "position" ? parsePosition : parseDuration;
      const write = kind === "position" ? beatsToPosition : beatsToDuration;
      /**
       * Already in the canonical new spelling ⇒ leave it. This is what makes the pass IDEMPOTENT,
       * and idempotence is not a nicety here: the rewrite reads with the OLD rule, so running it
       * twice would read its own output as something it never meant and shift the song by a
       * sixteenth. A second run must be a no-op or the script is a trap.
       *
       * The gap it leaves: a value that is canonical in the new notation AND meant something else
       * in the old one would be skipped. Such a value would have to be short, sub-beat, and exactly
       * what the writer emits — and `scan` over every project in ~/.studio/root found none. Where
       * one exists the two rules disagree, which is a thing that can be searched for.
       */
      if (write(back(old, num, den), num, den) === old) return;
      const beats = read(old, num, den);
      const next = write(beats, num, den);
      if (next === old) return;
      edits.push({ at: v.range[0], end: v.range[1], text: `"${next}"` });
      changes.push({
        key,
        from: old,
        to: next,
        // What the NEW reader will make of what we just wrote, against what the old one made of
        // what was there. That is the only comparison that says the song still sounds the same.
        driftBeats: Math.abs(back(next, num, den) - beats),
      });
    },
  });
  // Back to front, so an earlier splice cannot move a later one's offsets.
  edits.sort((a, b) => b.at - a.at);
  let out = text;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return { text: out, changes };
}
