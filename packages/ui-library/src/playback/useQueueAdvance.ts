// useQueueAdvance.ts — one track ends, the next starts. Mounted where the target lives, because
// that is what says WHERE a file plays. See ../../docs/miniPlayer.md.

import { takesOf } from "@studio/mediatek/takes";
import { useCallback, useEffect, useRef } from "react";
import { usePlayback } from "./PlaybackProvider";
import type { PlaybackTarget } from "./targets";

/** A song's MASTER, which is what "add to the queue" means: a variant is chosen one at a time. */
export const masterOf = (entry: Parameters<typeof takesOf>[0]): string | null =>
  takesOf(entry).find((t) => t.kind === "master")?.file ?? null;

/** Start the queue's next track that resolves, SKIPPING one that does not (../../docs/miniPlayer.md). */
export function useStartNext(target: PlaybackTarget): () => void {
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
        target,
      });
      return;
    }
  }, [playback.takeNext, playback.start, target]);
}

/** Advance when what was playing ends, and start the queue when nothing is playing. */
export function useQueueAdvance(target: PlaybackTarget): void {
  const playback = usePlayback();
  const startNext = useStartNext(target);

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
