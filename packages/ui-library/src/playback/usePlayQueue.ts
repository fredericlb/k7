// usePlayQueue.ts — the queue, held by MediaPlayback and passed to the transport.
//
// Here rather than in the provider because MediaPlayback RENDERS it: it sits above the context, and
// it carries the tree whose right-click fills the queue. One per tab, above the screens, like the
// transport itself. See ../../docs/miniPlayer.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import { useCallback, useRef, useState } from "react";
import {
  enqueue as enqueueInto,
  moveTo,
  type QueueItem,
  removeAt,
} from "./queue";

export interface PlayQueue {
  queue: QueueItem[];
  enqueue: (entries: MediatekEntry[]) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  /** Take the head and remove it, or `null`. */
  takeNext: () => QueueItem | null;
}

export function usePlayQueue(): PlayQueue {
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const enqueue = useCallback((list: MediatekEntry[]) => {
    setQueue((q) => enqueueInto(q, list));
  }, []);
  const removeFromQueue = useCallback((i: number) => {
    setQueue((q) => removeAt(q, i));
  }, []);
  const moveInQueue = useCallback((from: number, to: number) => {
    setQueue((q) => moveTo(q, from, to));
  }, []);

  /** Through a REF: the caller is an effect and must read the queue as it is at that instant. */
  const held = useRef(queue);
  held.current = queue;
  const takeNext = useCallback((): QueueItem | null => {
    const head = held.current[0];
    if (!head) return null;
    // Compared by identity before cutting, or two close calls remove two songs for one start.
    setQueue((q) => (q[0]?.id === head.id ? q.slice(1) : q));
    return head;
  }, []);

  return { queue, enqueue, removeFromQueue, moveInQueue, takeNext };
}
