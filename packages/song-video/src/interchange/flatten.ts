// flatten.ts — a picture lane as another editor reads one: SEQUENTIAL segments with no overlap,
// by the lane's own rule (the shot later in the file covers the ones before it), and the
// dissolves between them. Every interchange writer starts here, so OTIO and an EDL cannot read
// one lane two ways. Pure. See docs/interchange.md.

import type { VideoClipDoc, VideoTrackDoc } from "../videoDoc";

/** One stretch of the lane showing one shot, in timeline seconds; `sourceFrom` is where in the source it starts. */
interface Segment {
  clip: VideoClipDoc;
  start: number;
  end: number;
  sourceFrom: number;
}

/** A dissolve INTO the segment at `index`, over `over` seconds after its start — the outgoing one runs on under it. */
interface Dissolve {
  index: number;
  over: number;
}

export interface FlatLane {
  segments: Segment[];
  dissolves: Dissolve[];
  /** Shots that could not be placed, with why — an open-ended last shot whose source length is unknown. */
  skipped: string[];
}

/** The shot's end by the lane's rule: its length, the next shot's start, or its source's own end when that is known. */
function endOf(
  clips: readonly VideoClipDoc[],
  i: number,
  naturalSeconds: (c: VideoClipDoc) => number | undefined,
): number | undefined {
  const c = clips[i] as VideoClipDoc;
  if (c.length > 0) return c.start + c.length;
  const next = clips[i + 1];
  if (next) return next.start;
  const total = naturalSeconds(c);
  const speed = c.speed ?? 1;
  if (total === undefined || !(speed > 0)) return undefined;
  return c.start + (total - c.sourceFrom) / speed;
}

/** Flatten one lane; `naturalSeconds` answers a source's own length, for an open-ended last shot. */
export function flattenLane(
  lane: VideoTrackDoc,
  naturalSeconds: (c: VideoClipDoc) => number | undefined = () => undefined,
): FlatLane {
  // An ACTIVATION is no material to hand over, and captions have no track OTIO or an EDL agree on.
  const clips = lane.clips.filter((c) => c.id !== "" && !c.captions);
  const skipped: string[] = [];
  const spans: { clip: VideoClipDoc; start: number; end: number }[] = [];
  clips.forEach((c, i) => {
    const end = endOf(clips, i, naturalSeconds);
    if (end === undefined)
      skipped.push(
        `${c.name}: runs to the end of a source whose length is unknown`,
      );
    else if (end > c.start) spans.push({ clip: c, start: c.start, end });
  });
  // Every instant a shot starts or ends; between two, the shot on top is the LAST one spanning it.
  const cuts = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort(
    (a, b) => a - b,
  );
  const segments: Segment[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k] as number;
    const b = cuts[k + 1] as number;
    const top = spans.filter((s) => s.start <= a && s.end >= b).at(-1);
    if (!top) continue;
    const last = segments.at(-1);
    if (last && last.clip === top.clip && Math.abs(last.end - a) < 1e-9)
      last.end = b;
    else
      segments.push({
        clip: top.clip,
        start: a,
        end: b,
        sourceFrom:
          top.clip.sourceFrom + (a - top.clip.start) * (top.clip.speed ?? 1),
      });
  }
  // A dissolve is the incoming shot's `fade_in`, at its OWN start, out of whatever was showing there.
  const dissolves: Dissolve[] = [];
  segments.forEach((s, index) => {
    const over = s.clip.fadeIn?.over ?? 0;
    if (over > 0 && Math.abs(s.start - s.clip.start) < 1e-9)
      dissolves.push({ index, over: Math.min(over, s.end - s.start) });
  });
  return { segments, dissolves, skipped };
}
