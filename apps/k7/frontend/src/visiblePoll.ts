// visiblePoll.ts — a poll that rests while the tab is hidden and never overlaps itself. A background tab
// asking the server every two or three seconds is load and battery for nothing; on its return the tab
// asks once at once. The NEXT tick is scheduled when this one ENDS, so a slow server slows the poll down
// instead of stacking requests behind it — the same rule as packages/ui-library/src/poll.ts.

/** Whether the page is out of sight — false where there is no document (a test under Node). */
const tabHidden = (): boolean =>
  typeof document !== "undefined" && document.hidden;

/** Run `fn` `ms` after each run ends while the tab is visible, and once on its return; the result stops both. */
export function pollWhileVisible(fn: () => unknown, ms: number): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    timer = undefined;
    if (stopped || running || tabHidden()) return;
    running = true;
    try {
      await fn();
    } catch {
      // A tick reports its own failure; the poll only keeps time.
    } finally {
      running = false;
    }
    if (!stopped && !tabHidden()) timer = setTimeout(run, ms);
  };

  const onVisible = () => {
    if (!tabHidden() && timer === undefined && !running) void run();
  };
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", onVisible);
  timer = setTimeout(run, ms);
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisible);
  };
}
