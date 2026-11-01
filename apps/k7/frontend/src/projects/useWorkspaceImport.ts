// useWorkspaceImport.ts — bringing a server's workspace down here as a job the person can see: a row in
// the download manager and a spinner on the workspace until the server's history has landed. The
// download route only LINKS the folder; the copy follows in the background, so "done" is read off the
// sync status, not off the route's answer. See ../../docs/projects.md.

import { trackDownload } from "@studio/http-client/downloads";
import type { WorkspaceSyncStatus } from "@studio/web-protocol";
import { useCallback, useState } from "react";
import { m } from "../paraglide/messages.js";
import { accountFiles } from "./api";
import type { AccountFiles } from "./workspaceOps";

/** How often the status is asked while an import runs. */
const POLL_MS = 2000;
/** Past this, the import is called failed: the folder stays linked and keeps syncing, the row says so. */
const GIVE_UP_MS = 30 * 60_000;

/** Whether workspace `name` (its name on the server) has come down and synced. */
export function importLanded(s: WorkspaceSyncStatus, name: string): boolean {
  return s.workspaces.some(
    (w) => (w.room ?? w.name) === name && w.state === "synced",
  );
}

async function untilLanded(files: AccountFiles, name: string): Promise<void> {
  const until = Date.now() + GIVE_UP_MS;
  while (Date.now() < until) {
    const s = await accountFiles.workspaceSync(files).catch(() => null);
    if (s && importLanded(s, name)) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(m["wsync.importSlow"]());
}

export function useWorkspaceImport(
  chosen: () => AccountFiles,
  onDone: () => void,
  onError: (message: string) => void,
): {
  importing: ReadonlySet<string>;
  start: (name: string) => Promise<void>;
} {
  const [importing, setImporting] = useState<ReadonlySet<string>>(new Set());
  const start = useCallback(
    async (name: string) => {
      setImporting((s) => new Set(s).add(name));
      const job = trackDownload({
        key: `workspace:${name}`,
        kind: "workspace",
        label: name,
      });
      try {
        const files = chosen();
        await accountFiles.downloadWorkspace(files, name);
        await untilLanded(files, name);
        job.end();
      } catch (e) {
        job.end((e as Error).message);
        onError((e as Error).message);
      } finally {
        setImporting((s) => {
          const next = new Set(s);
          next.delete(name);
          return next;
        });
        onDone();
      }
    },
    [chosen, onDone, onError],
  );
  return { importing, start };
}
