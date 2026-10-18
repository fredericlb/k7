// ServerOnlyList.tsx — the workspaces a paired server holds and this machine does not, each with
// its Download. Never brought down on their own: one with big takes is the person's call.

import { Button } from "@frediverse/ui/button";
import { Cloud, CloudDownload, Loader2 } from "@frediverse/ui/icons";
import type { WorkspaceSyncStatus } from "@studio/web-protocol";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { hostLabel } from "./WorkspaceSyncIcon";

export function ServerOnlyList({
  sync,
  onDownload,
}: {
  sync: WorkspaceSyncStatus | null;
  onDownload?: (name: string, server?: string) => Promise<void>;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const serverOnly = (sync?.workspaces ?? []).filter(
    (w) => w.state === "server",
  );
  if (serverOnly.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {serverOnly.map((w) => (
        <li
          key={`${w.server ?? ""} ${w.name}`}
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
            disabled={!onDownload || downloading !== null}
            onClick={() => {
              if (!onDownload) return;
              const key = `${w.server ?? ""} ${w.name}`;
              setDownloading(key);
              void onDownload(w.name, w.server).finally(() =>
                setDownloading(null),
              );
            }}
          >
            {downloading === `${w.server ?? ""} ${w.name}` ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5" />
            )}{" "}
            {m["wsync.download"]()}
          </Button>
        </li>
      ))}
    </ul>
  );
}
