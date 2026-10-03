// useWorkspaceSync.ts — every workspace's sync state, by name, on a timer of its own: slower than
// the list's, because the file service may fetch to answer it. `refresh` asks again now, after an
// act from this page that moved a repository. See ../../docs/projects.md.

import type { WorkspaceSync } from "@studio/web-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AccountFiles, accountFiles } from "./api";

/** Often enough to notice a commit pushed from elsewhere; the service fetches once a minute at most anyway. */
const SYNC_POLL_MS = 20_000;

export function useWorkspaceSync(fileService: AccountFiles | null): {
  sync: Record<string, WorkspaceSync>;
  refresh: () => void;
} {
  const [sync, setSync] = useState<Record<string, WorkspaceSync>>({});
  const last = useRef("");

  const load = useCallback(async () => {
    if (!fileService) return;
    try {
      const rows = await accountFiles.workspaceSync(fileService);
      const text = JSON.stringify(rows);
      if (text === last.current) return;
      last.current = text;
      setSync(Object.fromEntries(rows.map((r) => [r.name, r])));
    } catch {
      // A row without its sync line is what an older or silent service looks like; the list says the rest.
    }
  }, [fileService]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), SYNC_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Stable, so a caller may list it in its own dependencies.
  const refresh = useCallback(() => void load(), [load]);
  return { sync, refresh };
}
