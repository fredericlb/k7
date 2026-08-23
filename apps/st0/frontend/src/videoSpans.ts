// videoSpans.ts — when each video lane is putting a picture on screen, in seconds, so the graph's
// cables can ripple for the frame as they do for sound. DERIVED like rackLit.ts: the engine
// meters no picture, but the browser holds the shots and the playhead. The interval rule is the
// COMPOSITOR's (`activeAt` in @studio/ui-eyes) and videoSpans.test.ts pins the two together.

import type { LaneSpan } from "@studio/ui-chains/cables";
import type { WebVideoProject, WebVideoTrack } from "@studio/web-protocol";

/** One lane's spans, or none when it shows nothing — three rules, all the realtime driver's: hidden, shape, and a shot with no `length`. */
function spansOf(t: WebVideoTrack): LaneSpan[] {
  if (t.mute) return [];
  if (!t.clips.length)
    return t.shapes.length ? [{ from: 0, to: Number.POSITIVE_INFINITY }] : [];
  return t.clips.map((c, i) => ({
    from: c.start,
    to:
      c.length > 0
        ? c.start + c.length
        : i + 1 < t.clips.length
          ? t.clips[i + 1].start
          : Number.POSITIVE_INFINITY,
  }));
}

/** The whole picture's spans, by lane id — a lane with nothing to show is left OUT, the renderer walking these keys on every frame. */
export function videoSpans(
  doc: WebVideoProject | null | undefined,
): Record<string, LaneSpan[]> {
  const out: Record<string, LaneSpan[]> = {};
  for (const t of doc?.videoTracks ?? []) {
    const spans = spansOf(t);
    if (spans.length) out[t.id] = spans;
  }
  return out;
}
