// timelineView.ts — the document the timeline pane draws: the song's, or one of the project's other
// timelines, its lanes standing in for the song's tracks so every gesture addresses them unchanged.
// What a reader gets wrong: the engine plays the open timeline through a SONG lane, so a timeline's
// lanes have no meter, arm or marker of their own (docs/timeline.md).

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
