// timecodeMigrate.ts — rewrite a document's timecodes in the short `bar:beat:sub.ticks` form.
// The parser still reads the old deep colon chain, so nothing is broken by leaving them; but every
// WRITER emits the short form now, so an untouched song drifts into two spellings the moment
// anything is edited. Driven by scripts/migrateTimecodes.ts. See docs/timecode.md.

import {
  beatsToDuration,
  beatsToPosition,
  parseDuration,
  parseLegacyDuration,
  parseLegacyPosition,
  parsePosition,
} from "@studio/song-schema/timecode";
import { TIMECODE } from "@studio/song-schema/yaml/placementSchema";
import { isScalar, parseDocument, visit } from "yaml";

/** Which fields hold a timecode, and whether it counts from 1 or from 0 — see docs/timecode.md. */
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

/** Rewrite one document's timecodes, SPLICED by source offset rather than re-serialised — docs/timecode.md. */
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
      // A STRING only: `from: 0.25` is SECONDS into a file, not a timecode (AudioClipSchema).
      if (!isScalar(v) || typeof v.value !== "string" || !v.range) return;
      const old = v.value.trim();
      if (!TIMECODE.test(old)) return;
      const read =
        kind === "position" ? parseLegacyPosition : parseLegacyDuration;
      const back = kind === "position" ? parsePosition : parseDuration;
      const write = kind === "position" ? beatsToPosition : beatsToDuration;
      // Already canonical ⇒ leave it; this is what makes the pass IDEMPOTENT (docs/timecode.md).
      if (write(back(old, num, den), num, den) === old) return;
      const beats = read(old, num, den);
      const next = write(beats, num, den);
      if (next === old) return;
      edits.push({ at: v.range[0], end: v.range[1], text: `"${next}"` });
      changes.push({
        key,
        from: old,
        to: next,
        // The NEW reading of what was written against the OLD reading of what was there.
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
