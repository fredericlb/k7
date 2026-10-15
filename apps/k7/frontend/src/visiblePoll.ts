// visiblePoll.ts — an interval that waits while the tab is hidden. A background tab asking the
// server every two or three seconds, for an answer nobody is looking at, is load and battery for
// nothing; on its return the tab asks once at once, so what it shows is never a full period stale.

/** Whether the page is out of sight — false where there is no document (a test under Node). */
export const tabHidden = (): boolean =>
  typeof document !== "undefined" && document.hidden;

/** Run `fn` every `ms` while the tab is visible, and once on its return; the result stops both. */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const id = setInterval(() => {
    if (!tabHidden()) fn();
  }, ms);
  const onVisible = () => {
    if (!tabHidden()) fn();
  };
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisible);
  };
}
