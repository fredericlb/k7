// targets.ts — WHERE the médiathèque makes sound: the list of destinations, what each one
// means, and what it needs to work. One list, so a third destination is one entry here and
// nothing else. See ../../docs/playbackTarget.md.

import { Laptop, type LucideIcon, Radio, Speaker } from "lucide-react";

/** A destination's id. It is what is stored on the account, so these strings are permanent. */
export type PlaybackTarget = "browser" | "engine" | "machine";

export interface PlaybackTargetInfo {
  id: PlaybackTarget;
  label: string;
  /** One line under the label — what actually happens, not a restatement of the label. */
  hint: string;
  icon: LucideIcon;
  /** True when the destination needs a reachable engine, so the menu says so instead of offering silence. */
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
    id: "engine",
    label: "Le moteur",
    hint: "joué par la machine choisie, sur ses propres sorties",
    icon: Speaker,
    needsEngine: true,
  },
  {
    id: "machine",
    label: "Les enceintes de la machine",
    // Nothing is asked of the engine, so st0 may use it at the same time and no file crosses the network.
    hint: "joué par la machine elle-même, sans passer par le moteur",
    icon: Radio,
    // `true` although the engine plays NOTHING: it is how the machine is discovered and hands its token over.
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

/** A destination's row, for drawing it. Never undefined — an unknown id narrows first. */
export function playbackTargetInfo(id: PlaybackTarget): PlaybackTargetInfo {
  return (
    PLAYBACK_TARGETS.find((t) => t.id === id) ??
    // Unreachable through `asPlaybackTarget`, and non-optional so no caller invents a fallback.
    (PLAYBACK_TARGETS[0] as PlaybackTargetInfo)
  );
}

/** The destination ACTUALLY used, with the fallback decided once (../../docs/playbackTarget.md). */
export function effectiveTarget(
  chosen: PlaybackTarget,
  engineReady: boolean,
): PlaybackTarget {
  return playbackTargetInfo(chosen).needsEngine && !engineReady
    ? DEFAULT_PLAYBACK_TARGET
    : chosen;
}
