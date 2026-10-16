// boundedQueue.ts — at most `max` tasks running at once, the rest waiting in arrival order.
// With `maxWaiting`, a task arriving to a full queue is refused with `full()` rather than queued.

export interface BoundedQueue {
  run<T>(fn: () => Promise<T>): Promise<T>;
  load(): { active: number; waiting: number };
}

export function boundedQueue(opts: {
  max: number;
  maxWaiting?: number;
  full?: () => Error;
}): BoundedQueue {
  const { max, maxWaiting = Number.POSITIVE_INFINITY } = opts;
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= max) {
        if (waiting.length >= maxWaiting)
          throw opts.full?.() ?? new Error("queue full");
        await new Promise<void>((go) => waiting.push(go));
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
        waiting.shift()?.();
      }
    },
    load: () => ({ active, waiting: waiting.length }),
  };
}
