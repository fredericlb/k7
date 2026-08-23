// usePlaybackTarget.ts — the account's playback destination: read it once, change it
// optimistically, and remember it. The vocabulary is targets.ts; this is only the holder.
// See ../../docs/playbackTarget.md.

import { useCallback, useEffect, useState } from "react";
import { patchPrefs, readPrefs } from "../prefs";
import {
  asPlaybackTarget,
  DEFAULT_PLAYBACK_TARGET,
  type PlaybackTarget,
} from "./targets";

export interface PlaybackChoice {
  /** What the account asked for. NOT necessarily what will play — see `effectiveTarget`. */
  target: PlaybackTarget;
  /** The preference has come back once: before it, a default is indistinguishable from a choice. */
  loaded: boolean;
  choose: (t: PlaybackTarget) => void;
}

export function usePlaybackTarget(): PlaybackChoice {
  const [target, setTarget] = useState<PlaybackTarget>(DEFAULT_PLAYBACK_TARGET);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readPrefs().then((p) => {
      if (cancelled) return;
      setTarget(asPlaybackTarget(p.playbackTarget));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistic then persisted, through `patchPrefs` so the engine id survives (../../docs/engine.md).
  const choose = useCallback((t: PlaybackTarget) => {
    setTarget(t);
    void patchPrefs({ playbackTarget: t });
  }, []);

  return { target, loaded, choose };
}
