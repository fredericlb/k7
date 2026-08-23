// videoSpans.ts — when each video lane is putting a picture on screen, in seconds, so the graph's
// cables can ripple for the frame as they do for sound. DERIVED like rackLit.ts: the engine
// meters no picture, but the browser holds the shots and the playhead. The interval rule is the
// COMPOSITOR's (`activeAt` in @studio/ui-eyes) and videoSpans.test.ts pins the two together.

import type { LaneSpan } from "@studio/ui-chains/cables";
import type { WebVideoProject, WebVideoTrack } from "@studio/web-protocol";

/**
 * One lane's spans, or none when it shows nothing at all.
 *
 * Three rules, and all three are the realtime driver's rather than this file's — a cable that
 * ripples while the viewport is black would be worse than one that never ripples:
 *
 * - a HIDDEN lane draws nothing, so it carries nothing (`mute` is what "hidden" is called on the
 *   document, since a lane is muted the same way whatever it holds);
 * - a SHAPE lane has no media to place: it draws for as long as it is unhidden;
 * - a shot with no `length` runs to the NEXT one, or forever — its true end is inside a file
 *   nobody has opened. Authored order, not sorted: that is the order `activeAt` reads too.
 */
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

/**
 * The whole picture's spans, by lane id — what `DomChains` takes as `videoSpans`.
 *
 * A lane with nothing to show is left OUT rather than given an empty list: the renderer walks
 * these keys on every engine frame, and a lane that can never be live is a lane not worth
 * walking. Empty for a song with no picture, which is most of them.
 */
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
