// useQueueAdvance.ts — one track ends, the next starts. Mounted where the chosen machine and the
// target live, because that is what says WHERE a file plays. See ../../docs/miniPlayer.md.

import { takesOf } from "@studio/mediatek/takes";
import { useCallback, useEffect, useRef } from "react";
import { currentUser } from "../api";
import { cacheRoot, playablePath } from "../engine/songPreview";
import { usePlayback } from "./PlaybackProvider";
import { effectiveTarget, type PlaybackTarget } from "./targets";

/** A song's master, which is what "add to the queue" means. Variants are chosen on the song's
 *  page, one at a time, which a queue is not. */
const masterOf = (entry: Parameters<typeof takesOf>[0]): string | null =>
  takesOf(entry).find((t) => t.kind === "master")?.file ?? null;

/**
 * Advance the queue when what was playing ends.
 *
 * `ended` is a counter, so it is compared against what was seen rather than treated as a flag
 * somebody has to reset.
 *
 * A track that does not resolve is SKIPPED rather than blocking: a queue stopping on its third
 * title because one machine lacks the cache is a queue you cannot listen to while repairing it.
 * Unless the TARGET itself is missing — then everything would fail, and running the whole queue
 * to find that out would look like a broken queue.
 */
export function useQueueAdvance(
  machine: { fileBase: string | null; token: string | null; ready: boolean },
  target: PlaybackTarget,
): void {
  const playback = usePlayback();
  const actual = effectiveTarget(target, machine.ready);
  const viaEngine = actual === "engine";

  // This machine's cache, asked once per machine. `undefined` is "not known yet", which is
  // neither "there is one" nor "there is none" — hence three states rather than two.
  const root = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    root.current = undefined;
    if (!viaEngine || !machine.fileBase || !machine.token) return;
    let stop = false;
    void cacheRoot(machine.fileBase, currentUser(), machine.token)
      .then((r) => {
        if (!stop) root.current = r;
      })
      .catch(() => {
        if (!stop) root.current = null;
      });
    return () => {
      stop = true;
    };
  }, [viaEngine, machine.fileBase, machine.token]);

  const startNext = useCallback(() => {
    // While any are left: skip what does not resolve rather than stopping on it.
    for (;;) {
      const next = playback.takeNext();
      if (!next) return;
      const file = masterOf(next.entry);
      if (!file) continue;
      const enginePath =
        viaEngine && root.current
          ? playablePath(root.current, next.entry, file)
          : null;
      // No cache on the machine: a fault of the target, not of the row, and draining the queue
      // over it would erase what somebody just put there.
      if (viaEngine && !enginePath) return;
      playback.start({
        entry: next.entry,
        path: `${next.entry.path}/${file}`,
        target: actual,
        enginePath,
      });
      return;
    }
  }, [playback.takeNext, playback.start, viaEngine, actual]);

  const seen = useRef(playback.ended);
  useEffect(() => {
    if (playback.ended === seen.current) return;
    seen.current = playback.ended;
    startNext();
  }, [playback.ended, startNext]);

  /**
   * The cold start: queueing while nothing plays begins at once.
   *
   * Without it the queue could never start — the advance above listens only for the END of a
   * track, so a first add would sit there forever. `now` is not cleared when a track ends, so
   * this fires only before the first play or after closing the bar, never between two titles.
   */
  useEffect(() => {
    if (playback.now || !playback.queue.length) return;
    startNext();
  }, [playback.now, playback.queue.length, startNext]);
}
