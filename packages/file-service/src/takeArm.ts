// takeArm.ts — which EVENT a session's next take is recorded into, from the takes view: where the
// recorded file goes (a take of that event, not a new clip on the lane), and the HOLE the engine is
// sent instead of the lane's playing material over the punch, so the old performance is heard
// around the new one and not under it. Per session, in memory: an armed take is not a file.
// See packages/song/docs/takes.md.

import { cutHole } from "@studio/song/compClips";
import type { ProjectDoc } from "@studio/song/project";

/** The event a take goes into, by its lane and where it starts, and the punch: `to` absent runs to the stop. */
export interface TakeArm {
  track: string;
  eventBeats: number;
  punch: { from: number; to?: number };
}

const arms = new Map<string, TakeArm>();

/** Arm `session` for a take, or (null) back to recording onto the lane. */
export function setTakeArm(session: string, arm: TakeArm | null): void {
  if (arm) arms.set(session, arm);
  else arms.delete(session);
}

export function takeArmOf(session: string): TakeArm | null {
  return arms.get(session) ?? null;
}

/** What the engine is sent while a take is armed: the punch cut out of the lane, and the lane left unmuted. */
export function withTakeHole(session: string, doc: ProjectDoc): ProjectDoc {
  const arm = arms.get(session);
  if (!arm) return doc;
  return {
    ...doc,
    recordMute: false,
    tracks: doc.tracks.map((t) =>
      t.id === arm.track
        ? {
            ...t,
            clips: cutHole(
              t.clips,
              arm.punch.from,
              arm.punch.to ?? Number.POSITIVE_INFINITY,
              doc.tempo,
            ),
          }
        : t,
    ),
  };
}
