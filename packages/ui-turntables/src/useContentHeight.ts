// useContentHeight.ts — an element's CONTENT height, kept current. The desk draws itself against
// the room it has (deskLayout.ts), and the room it has is not knowable from props: the same
// surface is a half-height pane, a fullscreened one, and a phone in landscape.

import { type RefObject, useEffect, useState } from "react";

/**
 * Watch an element and report its content-box height in CSS pixels.
 *
 * `contentRect`, so padding is already off: the caller measures the box its children actually
 * get, and does not have to know what the wrapper's padding class happens to be.
 *
 * 0 until the observer first fires, which is one frame. Every consumer here is a `deskLayout`
 * call, and that is total — 0 answers with the tightest layout rather than a crash — so the
 * first frame draws a legible desk and the second draws the right one. An initial read in a
 * layout effect would trade a re-render for a forced reflow on every mount to save that frame.
 */
export function useContentHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return height;
}
