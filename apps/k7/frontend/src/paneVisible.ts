// paneVisible.ts — whether the pane a component sits in is ON SCREEN. A pane is hidden with CSS
// and never unmounted (apps/k7/AGENTS.md), so without this its per-frame work keeps running for
// nobody: the playhead's animation loops and the lane meters' renders. Default true, so a
// component outside any pane behaves as before. See docs/audit.md.

import { createContext, useContext } from "react";

export const PaneVisible = createContext(true);

/** Whether this component's pane is drawn; per-frame work is skipped while it is not. */
export const usePaneVisible = (): boolean => useContext(PaneVisible);
