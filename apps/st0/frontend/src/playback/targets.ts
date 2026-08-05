// targets.ts — WHERE the médiathèque makes sound: the list of destinations, what each one
// means, and what it needs to work. One list, so a third destination is one entry here and
// nothing else. See ../../docs/playbackTarget.md.

import { Laptop, type LucideIcon, Speaker } from "lucide-react";

/** A destination's id. It is what is stored on the account, so these strings are permanent. */
export type PlaybackTarget = "browser" | "engine";

export interface PlaybackTargetInfo {
  id: PlaybackTarget;
  label: string;
  /** One line under the label — what actually happens, not a restatement of the label. */
  hint: string;
  icon: LucideIcon;
  /** True when the destination cannot work without a reachable engine, so the menu can say
   *  so instead of offering a choice that would be silence. */
  needsEngine: boolean;
}

/**
 * The destinations, in the order the menu draws them.
 *
 * A LIST and a dropdown rather than a switch, because two is where this starts and not where
 * it stops: streaming the engine's output back to this browser is already half-built
 * (`@studio/engine-browser/stream`), and a machine that is neither is the obvious third. A
 * boolean would have to be replaced on the day any of those lands; an entry here does not.
 */
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
];

/**
 * The browser, and deliberately so.
 *
 * It is the destination that needs NOTHING — no engine chosen, no machine turned on, no copy
 * of the song on somebody else's disk. A default that can fail to make a sound is a default
 * that makes the app look broken to whoever has just signed in for the first time.
 */
export const DEFAULT_PLAYBACK_TARGET: PlaybackTarget = "browser";

/**
 * Narrow whatever was stored back to a destination.
 *
 * The preference is kept as a plain string on purpose (see the backend's `prefsSchema`), so
 * that adding a destination is a front-end change alone. The cost of that is exactly this
 * function: an unknown id — one this build has never heard of, written by a newer one in
 * another tab — reads as the default rather than as a target nothing can play.
 */
export function asPlaybackTarget(value: unknown): PlaybackTarget {
  return PLAYBACK_TARGETS.some((t) => t.id === value)
    ? (value as PlaybackTarget)
    : DEFAULT_PLAYBACK_TARGET;
}

/** A destination's row, for drawing it. Never undefined — an unknown id narrows first. */
export function playbackTargetInfo(id: PlaybackTarget): PlaybackTargetInfo {
  return (
    PLAYBACK_TARGETS.find((t) => t.id === id) ??
    // Unreachable through `asPlaybackTarget`, and typed as non-optional so callers do not
    // each invent their own fallback.
    (PLAYBACK_TARGETS[0] as PlaybackTargetInfo)
  );
}

/**
 * The destination that will ACTUALLY be used, given what is reachable right now.
 *
 * A remembered choice pointing at a machine that is switched off must not mean silence: the
 * bytes are on the hosted library either way, so the browser can always play them. This is
 * where that fallback is decided, once, rather than in each surface that plays something —
 * and the surfaces say which one they landed on, because sound coming out of the wrong
 * machine with no explanation is the confusing half of this feature.
 */
export function effectiveTarget(
  chosen: PlaybackTarget,
  engineReady: boolean,
): PlaybackTarget {
  return playbackTargetInfo(chosen).needsEngine && !engineReady
    ? DEFAULT_PLAYBACK_TARGET
    : chosen;
}
