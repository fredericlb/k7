// syncLinks.ts — the links a home page names: one account on one server each, several possibly on one server. A
// workspace's row says its link as `host · account` once there is more than one link, and as nothing with one.
// See ../../docs/projects.md.

import type { WorkspaceSyncStatus } from "@studio/web-protocol";
import { hostLabel } from "./WorkspaceSyncIcon";

export type SyncLink = NonNullable<WorkspaceSyncStatus["servers"]>[number];
type Entry = WorkspaceSyncStatus["workspaces"][number];

/** A link as a person reads it: `host · account`, or the host alone when the link names no account. */
export const linkLabel = (link: { origin: string; as?: string }): string =>
  link.as ? `${hostLabel(link.origin)} · ${link.as}` : hostLabel(link.origin);

/** Every link of `sync`, the main one first. */
export const linksOf = (sync: WorkspaceSyncStatus | null | undefined) =>
  sync?.servers ?? [];

/** The link a workspace's entry syncs with: by its id, else the first on its server. */
export function linkOfEntry(
  sync: WorkspaceSyncStatus | null | undefined,
  entry: Entry | null | undefined,
): SyncLink | undefined {
  if (!entry) return undefined;
  const links = linksOf(sync);
  return (
    (entry.link ? links.find((l) => l.id === entry.link) : undefined) ??
    links.find((l) => l.origin === entry.server)
  );
}

/** How a row names its link: nothing with one link, else `host · account` (the host alone for an entry with no link). */
export function entryLabel(
  sync: WorkspaceSyncStatus | null | undefined,
  entry: Entry | null | undefined,
): string {
  if (!entry || linksOf(sync).length < 2) return "";
  const link = linkOfEntry(sync, entry);
  return link ? linkLabel(link) : hostLabel(entry.server ?? "");
}

/** What a move or copy may target: every OTHER link, by the id the backend takes (its origin when it has none). */
export function moveTargetsOf(
  sync: WorkspaceSyncStatus | null | undefined,
  entry: Entry | null | undefined,
): { ref: string; label: string }[] {
  const from = linkOfEntry(sync, entry);
  return linksOf(sync)
    .filter((l) => l !== from)
    .map((l) => ({ ref: l.id ?? l.origin, label: linkLabel(l) }));
}
