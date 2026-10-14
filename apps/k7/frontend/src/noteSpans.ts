// noteSpans.ts — when each lane's notes are SOUNDING, in seconds, so a MIDI cable can ripple with
// what it carries. DERIVED like videoSpans.ts and for the same reason: the engine meters sound and
// says nothing about notes, but the browser holds both the notes and the playhead.
//
// The measure is the timeline's — velocities summed over what sounds at an instant (activity.ts
// buckets the same sum along a block). See @studio/ui-chains's noteLoad.ts.

import type { LaneNotes, NoteSpan } from "@studio/ui-chains/noteLoad";
import { laneNotes } from "@studio/ui-chains/noteLoad";
import type { WebClip, WebProject, WebTrack } from "./types";

/** The schema's default when a note states no velocity — NoteSchema's `v`, mirrored here. */
const FULL = 1;

/** One clip's notes as spans, clip-relative beats resolved onto the song's, then into seconds. */
function spansOfClip(clip: WebClip, perBeat: number): NoteSpan[] {
  const out: NoteSpan[] = [];
  for (const n of clip.notes) {
    const from = clip.start + n.time;
    // A zero-length note still sounds: the timeline gives it its bucket, so give it an instant.
    const to = from + (n.duration > 0 ? n.duration : 1 / 8);
    out.push({
      from: from * perBeat,
      to: to * perBeat,
      vel: n.vel ?? FULL,
    });
  }
  return out;
}

/** …and one lane's, over every MIDI clip on it. A muted lane sounds nothing, as videoSpans has it. */
function spansOfTrack(t: WebTrack, perBeat: number): NoteSpan[] {
  if (t.mute || t.disabled) return [];
  const out: NoteSpan[] = [];
  for (const c of t.clips)
    if (c.type === "midi" && !c.disabled) out.push(...spansOfClip(c, perBeat));
  return out;
}

/**
 * Every lane's notes and the busiest instant each reaches, by lane id. A lane with no notes is
 * left OUT — the seed builder walks these keys on every meter frame.
 *
 * Beats become SECONDS here because the playhead is in seconds, at the song's one tempo. A tempo
 * map would make this wrong in the same way it would make `videoSpans` wrong, and the day the
 * document carries one, both convert through it.
 */
export function noteSpans(
  doc: WebProject | null | undefined,
): Record<string, LaneNotes> {
  const bpm = doc?.tempo && doc.tempo > 0 ? doc.tempo : 120;
  const perBeat = 60 / bpm;
  const byLane: Record<string, NoteSpan[]> = {};
  for (const t of doc?.tracks ?? []) {
    const spans = spansOfTrack(t, perBeat);
    if (spans.length) byLane[t.id] = spans;
  }
  return laneNotes(byLane);
}
