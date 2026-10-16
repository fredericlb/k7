// useContentHeight.ts — an element's CONTENT height, kept current. The desk draws itself against
// the room it has (deskLayout.ts), and the room it has is not knowable from props: the same
// surface is a half-height pane, a fullscreened one, and a phone in landscape.

import { type RefObject, useEffect, useState } from "react";

/** An element's CONTENT-box height in CSS pixels — 0 for one frame, which `deskLayout` answers. */
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
