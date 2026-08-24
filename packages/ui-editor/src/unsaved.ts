// unsaved.ts — the browser's own "leave site?" prompt, for work that is not on disk. Autosave
// answers for the panes it drives, but nothing answered for a RELOAD: a held buffer lives in a
// module-level Map and a Save button's draft lives in React, and both die with the page without
// a word. One listener, however many panes claim it. See docs/autosave.md.

import { useEffect, useId } from "react";

// Every CLAIM currently open, by the claiming hook's own id — never by path, since two panes may show one file.
const claims = new Set<string>();

const onBeforeUnload = (e: BeforeUnloadEvent) => {
  if (!claims.size) return;
  // Both halves of the spec: preventDefault is what current browsers read, returnValue what older ones do.
  e.preventDefault();
  e.returnValue = "";
};

/** True while any pane is holding work that is not on disk — for a host that wants to ask before it navigates. */
export const hasUnsaved = (): boolean => claims.size > 0;

/** Hold the tab while `active`. The claim is this hook instance's, so releasing one never releases another's. */
export function useUnsavedGuard(active: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    claims.add(id);
    if (claims.size === 1)
      window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      claims.delete(id);
      if (!claims.size)
        window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active, id]);
}
