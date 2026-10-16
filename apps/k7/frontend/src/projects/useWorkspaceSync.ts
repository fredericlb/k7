// useWorkspaceSync.ts — where each workspace lives, on a machine paired with a remote server: synced,
// here only, or there only. Read on open, when the list changes, and every half minute while the tab is visible; nothing when unpaired.
// See ../../docs/projects.md.

import type {
  AccountWorkspace,
  WorkspaceSyncStatus,
} from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { keepIfSame } from "../shellEquality";
import { pollWhileVisible } from "../visiblePoll";
import { accountFiles } from "./api";
import type { AccountFiles } from "./workspaceOps";

const EVERY_MS = 30_000;
const RETRY_MS = 3_000;
const MOVING_MS = 3_000;

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
    let retry: ReturnType<typeof setTimeout> | undefined;
    void accountFiles
      .workspaceSync(fileService)
      .then((s) => live && setSync(keepIfSame(s.paired ? s : null)))
      // A service restarting (a pairing does that) answers nothing for a moment: ask again shortly, no icons meanwhile.
      .catch(() => {
        if (!live) return;
        setSync(null);
        retry = setTimeout(reload, RETRY_MS);
      });
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [fileService, workspaces, tick]);

  // A hidden tab asks nothing: the answer is for a row on screen, and the return asks once at once.
  useEffect(() => pollWhileVisible(reload, EVERY_MS), [reload]);

  // A move under way is watched closely: it ends on its own, and the row should say so when it does.
  const moving = sync?.workspaces.some((w) => w.moving && !w.moving.error);
  useEffect(() => {
    if (!moving) return;
    return pollWhileVisible(reload, MOVING_MS);
  }, [moving, reload]);

  return { sync, reload };
}
