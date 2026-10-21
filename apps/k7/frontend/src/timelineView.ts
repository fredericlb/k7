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

/** The open timeline once the ids changed: kept, or followed when it alone vanished as one alone appeared — a rename. */
export function followRename(
  open: string | null,
  before: readonly string[],
  after: readonly string[],
): string | null {
  if (!open || after.includes(open)) return open;
  const added = after.filter((id) => !before.includes(id));
  const gone = before.filter((id) => !after.includes(id));
  return gone.length === 1 && gone[0] === open && added.length === 1
    ? added[0]
    : null;
}
