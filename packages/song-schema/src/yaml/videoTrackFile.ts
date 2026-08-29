// videoTrackFile.ts — read and edit a video track's `events:` list, each placement
// `{ref, start, length, source_from}` in DECIMAL SECONDS. A SURGICAL text rewrite, like every
// other file editor here (trackFile.ts, sequenceFile.ts): these files carry the comments that
// document the format, and a round trip through the serialiser would delete every one of them.
// Browser-safe, because the editor's readers strip edits a buffer that has not been saved yet.
// Two ways in: by REF, which the drag uses, and by INDEX — packages/song-video/docs/picture.md.

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

/** Set (or clear) the lane's `mute:` — HIDDEN, there being no sound on a picture lane. */
export function setVideoLaneMute(text: string, mute: boolean): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  // Removed rather than written `false`: absent already means audible, and a file says what is unusual.
  if (mute) doc.setIn(["mute"], true);
  else doc.deleteIn(["mute"]);
  return doc.toString({ lineWidth: 0 });
}

/** Set the LANE's own rect — x/y/w/h, top-level keys, in viewport px (packages/song-video/docs/picture.md). */
export function setVideoLaneRect(
  text: string,
  rect: { x: number; y: number; w: number; h: number },
): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  // All four, always: a lane stating three of them and inheriting the fourth is a rect nobody can read.
  for (const k of ["x", "y", "w", "h"] as const)
    doc.setIn([k], Math.round(rect[k]));
  return doc.toString({ lineWidth: 0 });
}

/** Set one numeric field of the placement whose `ref` is `ref` — by REF and not by index, since a drag grabbed a strip. */
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

/** Set one numeric field of the placement at `index`. By POSITION, so a ref placed twice is still two placements. */
export function setVideoPlacementFieldAt(
  text: string,
  index: number,
  field: "source_from" | "length" | "start",
  value: number,
): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  const events = doc.getIn(["events"]);
  if (!isSeq(events) || index < 0 || index >= events.items.length) return text;
  // The same millisecond rounding the drag writes, so a verb and a gesture leave the same bytes.
  doc.setIn(["events", index, field], Math.round(value * 1000) / 1000);
  return doc.toString({ lineWidth: 0 });
}

/** Drop the placement at `index`, or the text unchanged when there is none there. */
export function removeVideoPlacementAt(text: string, index: number): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  const events = doc.getIn(["events"]);
  if (!isSeq(events) || index < 0 || index >= events.items.length) return text;
  events.items.splice(index, 1);
  return doc.toString({ lineWidth: 0 });
}

/** Append a placement, creating `events:` when the lane has none — a shape a `kind: shape` lane never gets. */
export function addVideoPlacement(
  text: string,
  p: VideoPlacement,
): string | null {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return null; // a half-typed lane is not one to append to
  }
  const ms = (n: number) => Math.round(n * 1000) / 1000;
  const entry: Record<string, string | number> = {
    ref: p.ref,
    start: ms(p.start),
    length: ms(p.length),
  };
  if (p.sourceFrom) entry.source_from = ms(p.sourceFrom);
  const events = doc.getIn(["events"]);
  if (!isSeq(events)) {
    // No `events:` at all, or one holding something else — only the absent case is ours to create.
    if (events !== undefined && events !== null) return null;
    doc.setIn(["events"], [entry]);
    return doc.toString({ lineWidth: 0 });
  }
  doc.addIn(["events"], entry);
  return doc.toString({ lineWidth: 0 });
}

/** Insert or delete seconds on a video lane, by INDEX since a ref may be placed twice — the lanes' rule otherwise. */
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
    // Milliseconds, the same rounding a drag writes, so a round trip compares byte for byte.
    doc.setIn(["events", i, "start"], Math.round(next * 1000) / 1000);
    moved++;
  }
  if (!moved && !removed) return { text, moved, removed };
  return { text: doc.toString({ lineWidth: 0 }), moved, removed };
}
