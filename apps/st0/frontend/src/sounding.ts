// sounding.ts — whether the engine is making sound right now, for the idle clock: a live rig
// played with the transport stopped is a session in use, and only the meters can tell.
// See packages/project-shell/docs/idle.md.

import type { EngineState } from "@studio/engine-protocol";

/** Below this the meters read noise floor, not someone playing. */
export const SOUNDING_DB = -50;

/** A playing transport, sound leaving the master, or signal on an input. */
export function soundingNow(
  s: Pick<EngineState, "playing" | "master" | "inputLevels">,
): boolean {
  if (s.playing) return true;
  if (s.master > SOUNDING_DB) return true;
  return s.inputLevels.some((db) => db > SOUNDING_DB);
}
