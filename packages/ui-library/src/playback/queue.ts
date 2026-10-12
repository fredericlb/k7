// queue.ts — what was queued up next. The operations are pure and kept apart: reordering a list
// is exactly the kind of code that goes off by one, and a player that loses the track just moved
// is not credible. See ../../docs/miniPlayer.md.

import type { MediatekEntry } from "@studio/mediatek/types";

/** Un morceau en attente: the ENTRY and not a path, since the machine can change before it plays. */
export interface QueueItem {
  /** The row's identity, and what prevents a duplicate: the song's path. */
  id: string;
  entry: MediatekEntry;
}

/** Queue up next without duplicates: adding twice is almost always a second click on one row. */
export function enqueue(
  queue: QueueItem[],
  entries: MediatekEntry[],
): QueueItem[] {
  const held = new Set(queue.map((q) => q.id));
  const added = entries
    .filter((e) => !held.has(e.path))
    .map((e) => ({ id: e.path, entry: e }));
  return added.length ? [...queue, ...added] : queue;
}

/** Remove the row at `i`; out of bounds returns the same queue, a stale id being a late click. */
export function removeAt(queue: QueueItem[], i: number): QueueItem[] {
  if (i < 0 || i >= queue.length) return queue;
  return [...queue.slice(0, i), ...queue.slice(i + 1)];
}

/** Move `from` to `to`, where `to` is the index in the FINAL list — hence tests both ways. */
export function moveTo(
  queue: QueueItem[],
  from: number,
  to: number,
): QueueItem[] {
  if (from < 0 || from >= queue.length) return queue;
  const target = Math.max(0, Math.min(queue.length - 1, to));
  if (target === from) return queue;
  const rest = [...queue.slice(0, from), ...queue.slice(from + 1)];
  return [...rest.slice(0, target), queue[from], ...rest.slice(target)];
}
