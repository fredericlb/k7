// videoTrackFile.ts — read and edit a video track's `clips:` list, each placement
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
  const clips = doc.getIn(["clips"]);
  if (!isSeq(clips)) return [];
  const out: VideoPlacement[] = [];
  clips.items.forEach((_item, i) => {
    const ref = doc.getIn(["clips", i, "ref"]);
    if (typeof ref !== "string" || !ref) return; // not a placement
    out.push({
      ref,
      start: num(doc.getIn(["clips", i, "start"])),
      length: num(doc.getIn(["clips", i, "length"])),
      sourceFrom: num(doc.getIn(["clips", i, "source_from"])),
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
  const clips = doc.getIn(["clips"]);
  if (!isSeq(clips)) return text;
  const at = clips.items.findIndex(
    (_item, i) => doc.getIn(["clips", i, "ref"]) === ref,
  );
  if (at < 0) return text;
  // Rounded to milliseconds: a drag's float noise doesn't belong in the file, and cutting needs no more.
  doc.setIn(["clips", at, field], Math.round(value * 1000) / 1000);
  return doc.toString({ lineWidth: 0 });
}
