// videoTrackFile.ts — read and edit a video track's `events:` list, each placement
// `{ref, start, length, source_from}` in DECIMAL SECONDS. A SURGICAL text rewrite, like every
// other file editor here (trackFile.ts, sequenceFile.ts): these files carry the comments that
// document the format, and a round trip through the serialiser would delete every one of them.
// Browser-safe, because the editor's readers strip edits a buffer that has not been saved yet.

import { isSeq, parseDocument } from "yaml";

export interface VideoPlacement {
  ref: string; // the `ref:` value — a clips/ id whose source is a video file
  start: number;
  length: number;
  sourceFrom: number;
}

const OPTS = { version: "1.2" as const, lineWidth: 0 };

const num = (v: unknown, dflt = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

/** The placements a video track declares, in file order. */
export function listVideoPlacements(text: string): VideoPlacement[] {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return []; // a half-typed file has no placements to show yet
  }
  const clips = doc.getIn(["events"]);
  if (!isSeq(clips)) return [];
  const out: VideoPlacement[] = [];
  clips.items.forEach((_item, i) => {
    const ref = doc.getIn(["events", i, "ref"]);
    if (typeof ref !== "string" || !ref) return; // not a placement
    out.push({
      ref,
      start: num(doc.getIn(["events", i, "start"])),
      length: num(doc.getIn(["events", i, "length"])),
      sourceFrom: num(doc.getIn(["events", i, "source_from"])),
    });
  });
  return out;
}

/**
 * Set one numeric field of the placement whose `ref` is `ref`. Returns the new text, or the
 * text unchanged when there is no such placement.
 *
 * By REF, not by index: the strip is keyed by ref, and a placement that moved in the file
 * between render and drag is still the one the user grabbed.
 */
export function setVideoPlacementField(
  text: string,
  ref: string,
  field: "source_from" | "length" | "start",
  value: number,
): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  const clips = doc.getIn(["events"]);
  if (!isSeq(clips)) return text;
  const at = clips.items.findIndex(
    (_item, i) => doc.getIn(["events", i, "ref"]) === ref,
  );
  if (at < 0) return text;
  // Rounded to milliseconds: a drag's float noise doesn't belong in the file, and cutting needs no more.
  doc.setIn(["events", at, field], Math.round(value * 1000) / 1000);
  return doc.toString({ lineWidth: 0 });
}

/**
 * Insert or delete `lenSeconds` of time at `atSeconds` on a video lane.
 *
 * Picture is DECIMAL SECONDS — no tempo map ever reaches it — so the caller converts the song's
 * beats once and hands the result down. Exact, because there is one tempo.
 *
 * By INDEX, unlike `setVideoPlacementField` above, and that is the point: a ref may appear twice
 * on one lane (the same shot placed twice), and this has to move both. The by-ref address is
 * right for a drag, where the user grabbed a particular strip; it is wrong for an operation on
 * the whole timeline, which is about every placement there is.
 *
 * Same rule as the lanes: by the placement's own `start`. Deleting drops the placements that
 * start inside the span and shifts the rest back, so insert-then-delete is a round trip.
 */
export function spliceVideoTime(
  text: string,
  atSeconds: number,
  lenSeconds: number,
  mode: "insert" | "delete",
): { text: string; moved: number; removed: number } {
  let doc: ReturnType<typeof parseDocument>;
  let moved = 0;
  let removed = 0;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return { text, moved, removed }; // a half-typed file is left exactly as it is
  }
  const events = doc.getIn(["events"]);
  if (!(lenSeconds > 0) || !isSeq(events)) return { text, moved, removed };
  const end = atSeconds + lenSeconds;
  // Descending, so removing one does not shift the address of the next.
  for (let i = events.items.length - 1; i >= 0; i--) {
    const start = num(doc.getIn(["events", i, "start"]));
    if (mode === "delete" && start >= atSeconds - 1e-6 && start < end - 1e-6) {
      events.items.splice(i, 1);
      removed++;
      continue;
    }
    const from = mode === "delete" ? end : atSeconds;
    if (start < from - 1e-6) continue;
    const next = start + (mode === "delete" ? -lenSeconds : lenSeconds);
    // Milliseconds, the same rounding a drag writes — so a splice and a drag leave the file in
    // the same shape and a round trip compares byte for byte.
    doc.setIn(["events", i, "start"], Math.round(next * 1000) / 1000);
    moved++;
  }
  if (!moved && !removed) return { text, moved, removed };
  return { text: doc.toString({ lineWidth: 0 }), moved, removed };
}
