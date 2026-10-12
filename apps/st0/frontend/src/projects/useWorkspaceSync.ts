// useWorkspaceSync.ts — where each workspace lives, on a machine paired with a remote server: synced,
// here only, or there only. Read on open, when the list changes, and every half minute; nothing when unpaired.
// See ../../docs/projects.md.

import type {
  AccountWorkspace,
  WorkspaceSyncStatus,
} from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { accountFiles } from "./api";
import type { AccountFiles } from "./workspaceOps";

const EVERY_MS = 30_000;

export function useWorkspaceSync(
  fileService: AccountFiles | null,
  workspaces: AccountWorkspace[],
): { sync: WorkspaceSyncStatus | null; reload: () => void } {
  const [sync, setSync] = useState<WorkspaceSyncStatus | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the list and the tick changing ARE the signal.
  useEffect(() => {
    if (!fileService) return setSync(null);
    let live = true;
    void accountFiles
      .workspaceSync(fileService)
      .then((s) => live && setSync(s.paired ? s : null))
      // A service that has no such route, or no server to ask: no icons rather than wrong ones.
      .catch(() => live && setSync(null));
    return () => {
      live = false;
    };
  }, [fileService, workspaces, tick]);

  useEffect(() => {
    const t = setInterval(reload, EVERY_MS);
    return () => clearInterval(t);
  }, [reload]);

  return { sync, reload };
}
