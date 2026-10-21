// timelinePlay.ts — which timeline a session AUDITIONS: while one is set, the engine is sent that
// timeline alone instead of the song, and the browser's document is left the song's. Per session,
// in memory, like an armed take: what the pane has open is not a file. See @studio/song docs/timelines.md.

import type { ProjectDoc } from "@studio/song/project";
import { auditionTimeline } from "@studio/song/timelineAudition";

const plays = new Map<string, string>();

/** Audition timeline `id` in `session`, or (null) play the song again. */
export function setTimelinePlay(session: string, id: string | null): void {
  if (id) plays.set(session, id);
  else plays.delete(session);
}

/** What the engine is sent: the auditioned timeline alone, or `doc` untouched. */
export function withTimelinePlay(session: string, doc: ProjectDoc): ProjectDoc {
  const id = plays.get(session);
  return id ? auditionTimeline(doc, id) : doc;
}
