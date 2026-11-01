// ServerOnlyList.tsx — the workspaces the active server holds and this machine does not, each with
// its Download. Never brought down on their own: one with big takes is the person's call. A workspace
// being imported stays here, spinning, until it is synced: listed above earlier, it would open half there.

import { Button } from "@frediverse/ui/button";
import { Cloud, CloudDownload, Loader2 } from "@frediverse/ui/icons";
import type { WorkspaceSyncStatus } from "@studio/web-protocol";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { hostLabel } from "./WorkspaceSyncIcon";

export function ServerOnlyList({
  sync,
  onDownload,
  importing = new Set(),
}: {
  sync: WorkspaceSyncStatus | null;
  onDownload?: (name: string) => Promise<void>;
  /** The workspaces whose import is under way, shown here with a spinner until they are synced. */
  importing?: ReadonlySet<string>;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const listed = (sync?.workspaces ?? []).filter((w) => w.state === "server");
  // An import keeps its row even once the status lists it here, until the import says it is whole.
  const serverOnly = [
    ...listed.filter((w) => !importing.has(w.name)),
    ...[...importing].map((name) => ({ name, server: sync?.server ?? null })),
  ];
  if (serverOnly.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {serverOnly.map((w) => (
        <li
          key={w.name}
          className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border p-3"
        >
          <span className="flex min-w-0 items-center gap-3 text-muted-foreground">
            <Cloud className="h-4 w-4 shrink-0" />
            <span className="truncate">{w.name}</span>
            <span className="text-xs">
              {m["wsync.onServerOnly"]({
                server: hostLabel(w.server ?? sync?.server ?? ""),
              })}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={
              !onDownload || downloading !== null || importing.has(w.name)
            }
            onClick={() => {
              if (!onDownload) return;
              setDownloading(w.name);
              void onDownload(w.name).finally(() => setDownloading(null));
            }}
          >
            {downloading === w.name || importing.has(w.name) ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5" />
            )}{" "}
            {importing.has(w.name)
              ? m["wsync.importing"]()
              : m["wsync.download"]()}
          </Button>
        </li>
      ))}
    </ul>
  );
}
