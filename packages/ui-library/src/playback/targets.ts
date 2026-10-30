// targets.ts — WHERE the médiathèque makes sound: on the engine the host's selector shows, heard
// where its radio says, and in this tab's <audio> element while no engine answers. Not a choice:
// the fallback is decided here, once. See ../../docs/playbackTarget.md.

import { Laptop, type LucideIcon, Radio } from "@frediverse/ui/icons";

/** A destination's id; its label and hint are the host's, under `labels.playback.targets[id]`. */
export type PlaybackTarget = "browser" | "engine";

export interface PlaybackTargetInfo {
  id: PlaybackTarget;
  icon: LucideIcon;
}

const TARGETS: Record<PlaybackTarget, PlaybackTargetInfo> = {
  browser: { id: "browser", icon: Laptop },
  engine: { id: "engine", icon: Radio },
};

/** The destination ACTUALLY used: the engine once one answers, else the browser, which needs nothing. */
export function effectiveTarget(engineAvailable: boolean): PlaybackTarget {
  return engineAvailable ? "engine" : "browser";
}

/** A destination's row, for drawing it. */
export function playbackTargetInfo(id: PlaybackTarget): PlaybackTargetInfo {
  return TARGETS[id];
}
