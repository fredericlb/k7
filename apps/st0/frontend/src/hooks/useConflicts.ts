// useConflicts — the workspace's open sync conflicts, from the page's one store (syncConflicts.ts).
// The revision is a second trigger, for where no change notice is pushed: docs/conflicts.md.

import { useEffect, useSyncExternalStore } from "react";
import { type ConflictsState, conflictsStore } from "../syncConflicts";
import { useRevision } from "./useRevision";

export function useConflicts(): ConflictsState & { refresh: () => void } {
  const state = useSyncExternalStore(
    conflictsStore.subscribe,
    conflictsStore.get,
    conflictsStore.get,
  );
  const rev = useRevision();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` is the trigger, not an input.
  useEffect(() => {
    void conflictsStore.refresh();
  }, [rev]);
  return { ...state, refresh: () => void conflictsStore.refresh() };
}
