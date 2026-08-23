// queue.ts — what was queued up next. The operations are pure and kept apart: reordering a list
// is exactly the kind of code that goes off by one, and a player that loses the track just moved
// is not credible. See ../../docs/miniPlayer.md.

import type { MediatekEntry } from "@studio/mediatek/types";

/**
 * Un morceau en attente.
 *
 * The ENTRY and not a resolved path: where the file plays depends on the chosen machine and its
 * cache, two things that can change between queueing and playing. So keep what is stable and
 * resolve at the last moment.
 */
export interface QueueItem {
  /** The row's identity, and what prevents a duplicate: the song's path. */
  id: string;
  entry: MediatekEntry;
}

/**
 * Queue up next, without duplicates.
 *
 * A song already waiting is not queued again: adding twice is almost always a second click on the
 * same row, and a queue playing the same title twice in a row is a fault nobody blames on the
 * click.
 */
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

/** Remove the row at index `i`. Out of bounds returns the same queue — a stale id is not a fault,
 *  it is a click on what has just played. */
export function removeAt(queue: QueueItem[], i: number): QueueItem[] {
  if (i < 0 || i >= queue.length) return queue;
  return [...queue.slice(0, i), ...queue.slice(i + 1)];
}

/**
 * Déplacer la ligne `from` à la position `to`.
 *
 * `to` is the WANTED index in the final list, not in the starting one. That difference is what
 * makes a downward move look like a no-op when it is missed: removing first shifts everything
 * after it, so the insert must happen in the already-shortened list. Tested both ways for that
 * reason.
 */
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
