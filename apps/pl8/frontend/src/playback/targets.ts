// targets.ts — WHERE the médiathèque makes sound. One list, so a destination is one entry here
// and nothing else. Two of the three need nothing — this tab, and the host that serves the
// files; the third needs a musician's machine to be answering.
// See ../../docs/playbackTarget.md.

import { Laptop, type LucideIcon, Radio, Speaker } from "lucide-react";

/** A destination's id. It is what is stored on the account, so these strings are permanent. */
export type PlaybackTarget = "browser" | "library" | "engine";

export interface PlaybackTargetInfo {
  id: PlaybackTarget;
  label: string;
  /** One line under the label — what actually happens, not a restatement of the label. */
  hint: string;
  icon: LucideIcon;
  /** True when it needs an engine to be ANSWERING, so the menu can say so instead of offering silence. */
  needsEngine: boolean;
}

/** The destinations in menu order — a LIST rather than a switch (../../docs/playbackTarget.md). */
export const PLAYBACK_TARGETS: PlaybackTargetInfo[] = [
  {
    id: "browser",
    label: "Cette machine",
    hint: "le fichier est téléchargé et joué par ce navigateur",
    icon: Laptop,
    needsEngine: false,
  },
  {
    id: "library",
    label: "La médiathèque",
    hint: "le serveur qui tient les fichiers les joue sur ses propres sorties",
    icon: Speaker,
    needsEngine: false,
  },
  {
    id: "engine",
    label: "Le moteur",
    hint: "joué par le moteur de votre machine, sur ses propres sorties",
    icon: Radio,
    needsEngine: true,
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

/** The destination ACTUALLY used, with the fallback decided ONCE — ../../docs/playbackTarget.md. */
export function effectiveTarget(
  chosen: PlaybackTarget,
  engineReady: boolean,
): PlaybackTarget {
  return playbackTargetInfo(chosen).needsEngine && !engineReady
    ? DEFAULT_PLAYBACK_TARGET
    : chosen;
}

/** A destination's row, for drawing it. Never undefined — an unknown id narrows first. */
export function playbackTargetInfo(id: PlaybackTarget): PlaybackTargetInfo {
  return (
    PLAYBACK_TARGETS.find((t) => t.id === id) ??
    // Unreachable through `asPlaybackTarget`, and non-optional so no caller invents a fallback.
    (PLAYBACK_TARGETS[0] as PlaybackTargetInfo)
  );
}
