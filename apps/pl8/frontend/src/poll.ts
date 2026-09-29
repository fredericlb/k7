// poll.ts — a poll that never overlaps itself, and rests while the tab is hidden unless told not to.
// The one thing a reader would get wrong: the NEXT tick is scheduled when this one ENDS, so a slow
// server slows the poll down instead of stacking requests behind it (../docs/audit.md).

export interface PollOptions {
  /** Keep ticking in a hidden tab — for a transport whose end must still advance the queue. */
  whileHidden?: boolean;
}

/** Run `tick` now and `everyMs` after each run ends; the returned function stops it. */
export function poll(
  tick: () => unknown,
  everyMs: number,
  opts: PollOptions = {},
): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resting = () => !opts.whileHidden && document.hidden;

  const run = async () => {
    timer = undefined;
    if (stopped || running || resting()) return;
    running = true;
    try {
      await tick();
    } catch {
      // A tick reports its own failure; the poll only keeps time.
    } finally {
      running = false;
    }
    if (!stopped && !resting()) timer = setTimeout(run, everyMs);
  };

  // Back in view: tick at once rather than showing what was true when the tab was hidden.
  const onVisible = () => {
    if (!document.hidden && timer === undefined && !running) void run();
  };
  document.addEventListener("visibilitychange", onVisible);
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
