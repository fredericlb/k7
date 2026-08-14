// takeReview.ts — which lane a clip sits on, for the review panel's label. Its own module so the
// lookup can be tested without the shell: it is the one thing `ui review <clip>` has to work out,
// since the command names a clip and the panel says where it is playing.

import type { WebProject } from "./types";

/**
 * The id of the lane placing `clip`, or "" when nothing does.
 *
 * "" is not a failure. A take whose placement was never written — or was deleted while its file
 * stayed in `clips/` — is exactly what this is for, and it reviews the same: the waveform, the
 * onsets and the level are properties of the FILE, and none of them needs a lane.
 *
 * The first lane wins. A placement is a reference, so one clip may sit on several, but the label
 * answers "where is this playing" and listing them all would say less, not more.
 */
export function trackPlacing(
  project: WebProject | null | undefined,
  clip: string,
): string {
  if (!project || !clip) return "";
  for (const t of project.tracks)
    if (t.clips?.some((c) => c.id === clip)) return t.id;
  return "";
}
