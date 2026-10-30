// splash.ts — the page's startup splash (an app's index.html, `#k7-splash`) kept up through the
// waits React draws before the first real screen, and taken down once a commit shows none.
// A page with no such element makes every call here a no-op. See docs/launch.md, "The splash covers the waits of a start".

const SPLASH_ID = "k7-splash";
const LINE_ID = "k7-splash-status";

let waits = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const splash = () => document.getElementById(SPLASH_ID);

/** Gone for good after the first screen: a later wait is a bar over a page, never the cassette again. */
function release(): void {
  clearTimeout(timer);
  // A tick later, so a wait that replaces another within one commit holds it across the swap.
  timer = setTimeout(() => {
    if (waits === 0) splash()?.remove();
  }, 0);
}

/** A full-screen wait is on screen: the splash stays, and says `label` in place of the file count. */
export function holdSplash(label: string): () => void {
  if (!splash()) return () => {};
  waits++;
  const line = document.getElementById(LINE_ID);
  if (line) {
    // The inline file counter stops writing once the app speaks (index.html).
    line.dataset.app = "1";
    line.textContent = label;
  }
  clearTimeout(timer);
  return () => {
    waits--;
    release();
  };
}

/** Called after the root's first commit: with no wait holding it, the splash goes now. */
export function releaseSplash(): void {
  if (splash()) release();
}
