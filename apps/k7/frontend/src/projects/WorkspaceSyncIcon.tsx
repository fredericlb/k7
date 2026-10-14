// WorkspaceSyncIcon.tsx — one icon saying where a workspace lives on a paired machine: synced with the
// server, on this machine only, or on the server only. Nothing when the machine is not paired.
// See ../../docs/projects.md.

import { Cloud, CloudCheck, HardDrive } from "@frediverse/ui/icons";
import type { WorkspaceSyncStatus } from "@studio/web-protocol";
import { m } from "../paraglide/messages.js";

type State = WorkspaceSyncStatus["workspaces"][number]["state"];

/** The workspace's entry in `sync` — the one HERE, not a same-named one still on a server — or null. */
export function syncEntryOf(
  sync: WorkspaceSyncStatus | null,
  name: string,
): WorkspaceSyncStatus["workspaces"][number] | null {
  return (
    sync?.workspaces.find((w) => w.name === name && w.state !== "server") ??
    null
  );
}

/** The workspace's state in `sync`, or null when there is nothing to say. */
export function syncStateOf(
  sync: WorkspaceSyncStatus | null,
  name: string,
): State | null {
  return syncEntryOf(sync, name)?.state ?? null;
}

/** A server's host, for a label: `https://priv.st0.app` → `priv.st0.app`. */
export const hostLabel = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

export function WorkspaceSyncIcon({
  state,
  server,
}: {
  state: State | null;
  server: string | null;
}) {
  if (!state) return null;
  const host = server ? new URL(server).host : "";
  const said =
    state === "synced"
      ? m["wsync.synced"]({ server: host })
      : state === "local"
        ? m["wsync.local"]()
        : m["wsync.server"]({ server: host });
  const Icon =
    state === "synced" ? CloudCheck : state === "local" ? HardDrive : Cloud;
  return (
    <span
      title={said}
      role="img"
      aria-label={said}
      className="inline-flex shrink-0"
    >
      <Icon
        className={`size-3.5 ${state === "synced" ? "text-emerald-500" : "text-muted-foreground"}`}
      />
    </span>
  );
}
