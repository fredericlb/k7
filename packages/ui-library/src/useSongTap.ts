// useSongTap.ts — what a tap on a song row does: open its panel, or, tapped twice on a touch
// screen, play its master without opening anything. See ../docs/responsive.md.
// What reads wrong: on touch the open WAITS out the double-tap window; a mouse click never does.

import type { MediatekEntry } from "@studio/mediatek/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePlayback } from "./playback/PlaybackProvider";
import { masterOf } from "./playback/useQueueAdvance";

/** How long a first tap waits for a second before it opens the song. */
export const DOUBLE_TAP_MS = 300;

// Asked at each tap, not once: a laptop with a touch screen is both.
const touchScreen = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(hover: none)").matches === true;

export interface Tapper {
  tap: (entry: MediatekEntry) => void;
  dispose: () => void;
}

/** The tap logic without React: `open` after the window, `play` when the same song is tapped again inside it. */
export function createTapper(opts: {
  open: (entry: MediatekEntry) => void;
  play: (entry: MediatekEntry, master: string) => void;
  touch: () => boolean;
}): Tapper {
  let pending: { path: string; timer: ReturnType<typeof setTimeout> } | null =
    null;
  const clear = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };
  return {
    tap(entry) {
      const master = masterOf(entry);
      const again = pending?.path === entry.path;
      clear();
      // Nothing to play, or a pointer that double-clicks rather than double-taps: open at once.
      if (!master || !opts.touch()) return opts.open(entry);
      if (again) return opts.play(entry, master);
      pending = {
        path: entry.path,
        timer: setTimeout(() => {
          pending = null;
          opts.open(entry);
        }, DOUBLE_TAP_MS),
      };
    },
    dispose: clear,
  };
}

/** A song row's tap handler, opening through `open` and playing on the account's destination. */
export function useSongTap(
  open: (entry: MediatekEntry) => void,
): (entry: MediatekEntry) => void {
  const playback = usePlayback();
  // Read at the moment of the play, so a tapper made once never plays to a stale destination.
  const latest = useRef({ open, playback });
  latest.current = { open, playback };
  const tapper = useMemo(
    () =>
      createTapper({
        open: (entry) => latest.current.open(entry),
        play: (entry, master) => {
          const p = latest.current.playback;
          p.start({ entry, path: `${entry.path}/${master}` });
        },
        touch: touchScreen,
      }),
    [],
  );
  useEffect(() => tapper.dispose, [tapper]);
  return useCallback((entry: MediatekEntry) => tapper.tap(entry), [tapper]);
}
