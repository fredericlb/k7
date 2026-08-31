// targets.ts — WHERE the médiathèque makes sound. One list, so a destination is one entry here
// and nothing else — which is what let the moteur's two leave in one. Neither survivor asks
// anything of an engine: one plays in this tab, the other on the host that serves the files.
// See ../../docs/playbackTarget.md.

import { Laptop, type LucideIcon, Speaker } from "lucide-react";

/** A destination's id. It is what is stored on the account, so these strings are permanent. */
export type PlaybackTarget = "browser" | "library";

export interface PlaybackTargetInfo {
  id: PlaybackTarget;
  label: string;
  /** One line under the label — what actually happens, not a restatement of the label. */
  hint: string;
  icon: LucideIcon;
}

/** The destinations in menu order — a LIST rather than a switch (../../docs/playbackTarget.md). */
export const PLAYBACK_TARGETS: PlaybackTargetInfo[] = [
  {
    id: "browser",
    label: "Cette machine",
    hint: "le fichier est téléchargé et joué par ce navigateur",
    icon: Laptop,
  },
  {
    id: "library",
    label: "La médiathèque",
    hint: "le serveur qui tient les fichiers les joue sur ses propres sorties",
    icon: Speaker,
  },
];

/** The browser, deliberately: it is the destination that needs NOTHING to make a sound. */
export const DEFAULT_PLAYBACK_TARGET: PlaybackTarget = "browser";

/** Narrow whatever was stored back to a destination — the preference is a plain string on purpose. */
export function asPlaybackTarget(value: unknown): PlaybackTarget {
  return PLAYBACK_TARGETS.some((t) => t.id === value)
    ? (value as PlaybackTarget)
    : DEFAULT_PLAYBACK_TARGET;
}

/** A destination's row, for drawing it. Never undefined — an unknown id narrows first. */
export function playbackTargetInfo(id: PlaybackTarget): PlaybackTargetInfo {
  return (
    PLAYBACK_TARGETS.find((t) => t.id === id) ??
    // Unreachable through `asPlaybackTarget`, and non-optional so no caller invents a fallback.
    (PLAYBACK_TARGETS[0] as PlaybackTargetInfo)
  );
}
