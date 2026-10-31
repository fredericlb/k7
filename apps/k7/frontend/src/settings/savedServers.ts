// savedServers.ts — the servers a machine's account has saved, as its backend lists them (`/api/sync/remote`): one is
// ACTIVE, the only one anything talks to. A server's backend lists none, being the server.
// See packages/file-hub/docs/syncRelay.md and ../../docs/localApp.md.

import { useCallback, useEffect, useState } from "react";
import { hostLabel } from "../projects/WorkspaceSyncIcon";

export interface SavedServer {
  /** The link's id: what switching and removing name it by. */
  id: string;
  /** The server as a page links to it: `https://app.k7.rocks`. */
  origin: string;
  /** The account on that server. */
  as: string;
  active: boolean;
}

/** A saved server as a person reads it: `host · account`. */
export const serverLabel = (s: { origin: string; as: string }): string =>
  `${hostLabel(s.origin)} · ${s.as}`;

/** One call to the saved servers' route; throws what the backend said. */
export async function savedServersCall(
  method: string,
  path = "",
  body?: unknown,
): Promise<SavedServer[]> {
  const r = await fetch(`/api/sync/remote${path}`, {
    method,
    cache: "no-store",
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const answer = (await r.json().catch(() => ({}))) as {
    servers?: SavedServer[];
    error?: string;
  };
  if (!r.ok) throw new Error(answer.error ?? `${r.status}`);
  return answer.servers ?? [];
}

/** The saved servers, the active one first, and `reload`; null until the first answer. */
export function useSavedServers(): {
  servers: SavedServer[] | null;
  reload: () => void;
} {
  const [servers, setServers] = useState<SavedServer[] | null>(null);
  const reload = useCallback(() => {
    void savedServersCall("GET").then(setServers, () => setServers([]));
  }, []);
  useEffect(reload, [reload]);
  return { servers, reload };
}
