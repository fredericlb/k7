// queue.ts — one cut at a time. A separation is minutes of CPU with a 166 MB model resident,
// and this process serves every other request in the image beside it; two at once would make
// both slow and the catalogue slow with them. See ../../docs/stems.md.

import type { SeparateJob } from "@studio/web-protocol";

const waiting: Array<{ id: string; run: () => Promise<void> }> = [];
let running: string | null = null;

/** How many cuts are ahead of this one, or null when it is not waiting — running, or unknown. */
export function ahead(id: string): number | null {
  const i = waiting.findIndex((w) => w.id === id);
  return i < 0 ? null : i;
}

/** Take a slot. The run reports its own outcome onto its job; this only frees the slot after. */
export function enqueue(id: string, run: () => Promise<void>): void {
  waiting.push({ id, run });
  pump();
}

function pump(): void {
  if (running || !waiting.length) return;
  const next = waiting.shift();
  if (!next) return;
  running = next.id;
  // `catch` BEFORE `finally`, which passes a rejection on — ../../docs/stems.md.
  void next
    .run()
    .catch(() => {})
    .finally(() => {
      running = null;
      pump();
    });
}

/**
 * The wait drawn onto the job the poller ALREADY reads, so a queued cut and a running one are
 * one shape. `percent` is cleared rather than left at zero: a bar that sits at 0% for ten
 * minutes reads as a hang, where "queued · 2 ahead" reads as what it is.
 */
export function withWait(job: SeparateJob): SeparateJob {
  const n = ahead(job.id);
  if (n === null) return job;
  return {
    ...job,
    phase: n === 0 ? "queued · next" : `queued · ${n} ahead`,
    percent: null,
  };
}
