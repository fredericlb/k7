// syncHistory.ts — the workspace's sync history, from st0's backend at /api/sync/history (same session).
// It is the relay's ordered log, not the undo journal: packages/file-hub/docs/history.md.

import { serviceUrl } from "@studio/web-protocol/services";

const BASE = `${serviceUrl(globalThis.location?.origin ?? "", "st0")}/api/sync/history`;

export interface SyncCheckpoint {
  seq: number;
  name: string;
  ts: number;
  by: string;
}

export interface SyncEntry {
  seq: number;
  ts: number;
  replica: string;
  label: string;
  files: string[];
  parked: number;
}

export interface SyncChange {
  file: string;
  before: string | null;
  after: string | null;
  binary?: true;
}

export interface SyncHistory {
  head: number;
  checkpoints: SyncCheckpoint[];
  entries: SyncEntry[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    credentials: "include",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `sync history: ${res.status}`);
  return json;
}

const ws = (workspace: string) => encodeURIComponent(workspace);

export const syncHistory = {
  list: (workspace: string, limit = 50) =>
    call<SyncHistory>(`${ws(workspace)}?limit=${limit}`),
  checkpoint: (workspace: string, name: string) =>
    call<SyncCheckpoint>(`${ws(workspace)}/checkpoints`, { name }),
  diff: (workspace: string, from: number, to: number) =>
    call<{ files: SyncChange[] }>(
      `${ws(workspace)}/diff?from=${from}&to=${to}`,
    ).then((d) => d.files),
  restore: (workspace: string, seq: number) =>
    call<{ entry: SyncEntry | null }>(`${ws(workspace)}/restore`, { seq }),
};
