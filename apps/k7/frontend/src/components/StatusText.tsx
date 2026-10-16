// StatusText.tsx — the status line's text, the one reader of statusLine.ts's store, so a new
// line re-renders this span and nothing above it.

import { cn } from "@frediverse/ui/lib/utils";
import { useSyncExternalStore } from "react";
import type { StatusLineStore } from "../statusLine";

export function StatusText({
  store,
  fallback,
}: {
  store: StatusLineStore;
  /** Shown when nobody has anything to say — the project's root. */
  fallback?: string;
}) {
  const { text, refused, hint } = useSyncExternalStore(
    store.subscribe,
    store.get,
  );
  // The open menu speaks FIRST and borrows the line rather than writing it, so closing gives back what the app last said.
  const shown = hint || text || fallback;
  return (
    <span
      // This line is the shell's whole error channel, so it is also its only live region.
      role="status"
      aria-live="polite"
      // Truncation is the layout's, not the message's: the full text has to stay reachable.
      title={shown}
      className={cn(
        "truncate",
        // Only when the app's OWN last word was a refusal: a menu hint borrows this line and is nobody's verdict.
        !hint && refused && "text-amber-400",
      )}
    >
      {shown}
    </span>
  );
}
