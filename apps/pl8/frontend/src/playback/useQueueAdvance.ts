// useQueueAdvance.ts — one track ends, the next starts. Mounted where the chosen machine and the
// target live, because that is what says WHERE a file plays. See ../../docs/miniPlayer.md.

import { takesOf } from "@studio/mediatek/takes";
import { useCallback, useEffect, useRef } from "react";
import { currentUser } from "../api";
import { cacheRoot, playablePath } from "../engine/songPreview";
import { usePlayback } from "./PlaybackProvider";
import { effectiveTarget, type PlaybackTarget } from "./targets";

/** A song's MASTER, which is what "add to the queue" means: a variant is chosen one at a time. */
const masterOf = (entry: Parameters<typeof takesOf>[0]): string | null =>
  takesOf(entry).find((t) => t.kind === "master")?.file ?? null;

/** Advance when what was playing ends, SKIPPING a track that does not resolve (../../docs/miniPlayer.md). */
export function useQueueAdvance(
  machine: { fileBase: string | null; token: string | null; ready: boolean },
  target: PlaybackTarget,
): void {
  const playback = usePlayback();
  const actual = effectiveTarget(target, machine.ready);
  const viaEngine = actual === "engine";

  // This machine's cache, asked once: `undefined` is "not known yet", hence three states.
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
      // A fault of the TARGET and not of the row, so draining the queue over it would erase work.
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

  /** The cold start, since the advance above only listens for the END of a track. */
  useEffect(() => {
    if (playback.now || !playback.queue.length) return;
    startNext();
  }, [playback.now, playback.queue.length, startNext]);
}
