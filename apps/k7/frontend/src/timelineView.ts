// timelineView.ts — the document the timeline pane draws: the song's, or one of the project's other
// timelines, its lanes standing in for the song's tracks so every gesture addresses them unchanged.
// What a reader gets wrong: the transport still plays the SONG, so nothing on its clock — playhead,
// meters, arming, markers — belongs on a timeline's view (docs/timeline.md).

import type { WebProject, WebTimeline } from "@studio/web-protocol";

/** The document to draw with timeline `id` open, and that timeline; the song's own when it is gone. */
export function timelineView<D extends WebProject | null | undefined>(
  doc: D,
  id: string | null,
): { doc: D; timeline: WebTimeline | null } {
  const timeline = (id && doc?.timelines?.find((t) => t.id === id)) || null;
  if (!doc || !timeline) return { doc, timeline: null };
  return {
    doc: { ...doc, tracks: timeline.lanes, groups: [], markers: [] },
    timeline,
  };
}
