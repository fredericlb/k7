// desktopBusy.ts — `window.__k7Busy()`, which the desktop app calls before a quit to know whether the engine is playing or recording.
// Read from the engine store's latest frame when asked, never subscribed. See apps/k7-standalone/docs/standalone.md, "Quit".

import type { EngineState } from "@studio/engine-protocol";

/** Mirrors `K7Busy` in apps/k7-standalone/src/busy.ts; null when idle. */
export type K7Busy = "playing" | "recording" | null;

declare global {
  interface Window {
    __k7Busy?: () => K7Busy;
  }
}

/** What a frame says the transport is doing. */
export function busyOf(s: EngineState): K7Busy {
  const takes = Object.values(s.recorders ?? {}).some((r) => r.recording);
  if (takes || (s.playing && s.recordEnabled && s.armed.length > 0))
    return "recording";
  return s.playing ? "playing" : null;
}

/** Publish `__k7Busy` for `store`; the returned cleanup removes it if it is still this one. */
export function exposeBusy(store: {
  getSnapshot: () => EngineState;
}): () => void {
  const ask = () => busyOf(store.getSnapshot());
  window.__k7Busy = ask;
  return () => {
    if (window.__k7Busy === ask) delete window.__k7Busy;
  };
}
