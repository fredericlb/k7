// useQueueAdvance.ts — one track ends, the next starts; where it plays is the provider's to decide.
// See ../../docs/miniPlayer.md.

import { takesOf } from "@studio/mediatek/takes";
import { useCallback, useEffect, useRef } from "react";
import { usePlayback } from "./PlaybackProvider";

/** A song's MASTER, which is what "add to the queue" means: a variant is chosen one at a time. */
export const masterOf = (entry: Parameters<typeof takesOf>[0]): string | null =>
  takesOf(entry).find((t) => t.kind === "master")?.file ?? null;

/** Start the queue's next track that resolves, SKIPPING one that does not (../../docs/miniPlayer.md). */
export function useStartNext(): () => void {
  const playback = usePlayback();
  return useCallback(() => {
    // While any are left: skip what does not resolve rather than stopping on it.
    for (;;) {
      const next = playback.takeNext();
      if (!next) return;
      const file = masterOf(next.entry);
      if (!file) continue;
      playback.start({
        entry: next.entry,
        path: `${next.entry.path}/${file}`,
      });
      return;
    }
  }, [playback.takeNext, playback.start]);
}

/** Advance when what was playing ends, and start the queue when nothing is playing. */
export function useQueueAdvance(): void {
  const playback = usePlayback();
  const startNext = useStartNext();

  const seen = useRef(playback.ended);
  useEffect(() => {
    if (playback.ended === seen.current) return;
    seen.current = playback.ended;
    startNext();
  }, [playback.ended, startNext]);

  /** The cold start, since the advance above only listens for the END of a track. */
  useEffect(() => {
    if (playback.now || !playback.queue.length) return;
    startNext();
  }, [playback.now, playback.queue.length, startNext]);
}
