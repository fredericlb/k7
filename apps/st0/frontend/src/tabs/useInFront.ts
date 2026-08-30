// useInFront.ts — whether this page is the tab in front. Always true off the desktop app,
// where there are no tabs to be behind. See apps/studio-desktop/docs/tabs.md.

import { useEffect, useState } from "react";
import { tabBridge } from "./bridge";

export function useInFront(): boolean {
  const [front, setFront] = useState(() => tabBridge()?.state().active ?? true);
  useEffect(() => {
    const bridge = tabBridge();
    if (!bridge) return;
    // Re-read on subscribe: a message sent between the first render and here is not lost.
    setFront(bridge.state().active);
    return bridge.subscribe((s) => setFront(s.active));
  }, []);
  return front;
}
