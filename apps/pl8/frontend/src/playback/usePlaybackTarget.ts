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
  /** The preference has come back at least once. Before it, `target` is the default, which
   *  is indistinguishable from a default that was actually chosen; a menu can draw either,
   *  but anything that would ANNOUNCE the destination should wait for this. */
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

  // Optimistic, then persisted — the tick moves under the cursor rather than after a round
  // trip, exactly as the engine pick does. `patchPrefs` is what keeps this from clearing the
  // engine id: the route replaces the whole document.
  const choose = useCallback((t: PlaybackTarget) => {
    setTarget(t);
    void patchPrefs({ playbackTarget: t });
  }, []);

  return { target, loaded, choose };
}
