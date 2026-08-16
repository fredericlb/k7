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

/**
 * The beat `clip` is placed at on lane `track`, or null when it is not on it.
 *
 * What puts the song's ruler over the waveform. The recording panel used to answer this with the
 * beat the transport ROLLED at, which is right for the take that just landed and wrong for every
 * other one — a take picked out of the sidebar plays where IT sits, not where the last one did.
 */
export function placedBeat(
  project: WebProject | null | undefined,
  track: string,
  clip: string,
): number | null {
  const lane = project?.tracks.find((t) => t.id === track);
  const at = lane?.clips.find((c) => c.id === clip);
  return at ? at.start : null;
}

/** One row of the review panel's sidebar: a lane's take, or what the lane is playing. */
export interface TakeOption {
  /** Its 1-based number, as `track take select` names it — null for the one PLAYING. */
  n: number | null;
  /** The clip the row DRAWS. A take is a list of placements; the panel shows one waveform. */
  clip: string;
  /** The take's own name, when it has one. */
  name?: string;
  /** Where it begins in the song, in beats — where the transport goes to hear it. */
  startBeat: number;
  /** How many placements it holds. More than one means the waveform is the first of them. */
  events: number;
}

const optionOf = (
  n: number | null,
  clips: { id: string; start: number }[],
  name?: string,
): TakeOption => ({
  n,
  clip: clips[0]?.id ?? "",
  ...(name ? { name } : {}),
  // The EARLIEST placement, not the first written: the row's job is to say where to put the
  // playhead to hear this from its beginning, and a list is not necessarily in time order.
  // Bar one when it holds nothing, which is where a lane playing nothing begins.
  startBeat: clips.length
    ? clips.reduce((m, c) => Math.min(m, c.start), Infinity)
    : 0,
  events: clips.length,
});

/**
 * Every version of lane `track` there is to listen to: its takes, then what it is playing.
 *
 * In SLOT order, and the playing one last. A `select` exchanges two lists rather than moving
 * one, so a row's number does not change when you audition it — the list stays put under the
 * pointer instead of resorting itself around whichever take you last clicked.
 *
 * **Empty when the lane has no takes.** One recording produces no choice, and a sidebar
 * offering a choice of one is a column of nothing. See packages/song/docs/takes.md.
 */
export function takeOptions(
  project: WebProject | null | undefined,
  track: string,
): TakeOption[] {
  const lane = project?.tracks.find((t) => t.id === track);
  if (!lane?.takes?.length) return [];
  return [
    ...lane.takes.map((k, i) => optionOf(i + 1, k.clips, k.name)),
    optionOf(null, lane.clips),
  ];
}
