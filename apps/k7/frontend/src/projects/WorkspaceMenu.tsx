// WorkspaceMenu.tsx — the ⋮ at the end of a workspace's row: copy or move it to another server, or delete it.
// Each is confirmed through `askConfirm`, which says what it changes. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  CloudUpload,
  Copy,
  Loader2,
  MoreVertical,
  Trash2,
} from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { hostLabel } from "./WorkspaceSyncIcon";

export function WorkspaceMenu({
  workspace,
  blocked,
  onRemove,
  moveTargets = [],
  from = "",
  onMove,
  onCopy,
}: {
  workspace: string;
  /** Why nothing here can run — no file service, or one busy. Empty when it can. */
  blocked: string;
  onRemove: () => Promise<void>;
  /** The other servers it may be copied or moved to, as origins; none draws no entry. */
  moveTargets?: string[];
  /** The server it syncs with now, for the confirmation. */
  from?: string;
  onMove?: (to: string) => Promise<void>;
  onCopy?: (to: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const confirmThen = async (
    q: Parameters<typeof askConfirm>[0],
    act: () => Promise<void>,
  ) => {
    if (!(await askConfirm(q))) return;
    setBusy(true);
    try {
      await act();
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    confirmThen(
      {
        title: m["ws.removeTitle"]({ workspace }),
        body: m["ws.removeBody"](),
        confirmLabel: m["common.remove"](),
        danger: true,
      },
      onRemove,
    );

  const move = (to: string) =>
    confirmThen(
      {
        title: m["ws.moveTitle"]({ workspace, server: hostLabel(to) }),
        body: m["ws.moveBody"]({
          server: hostLabel(to),
          from: hostLabel(from),
        }),
        confirmLabel: m["ws.move"](),
      },
      () => onMove?.(to) ?? Promise.resolve(),
    );

  const copy = (to: string) =>
    confirmThen(
      {
        title: m["ws.copyTitle"]({ workspace, server: hostLabel(to) }),
        body: m["ws.copyBody"]({
          server: hostLabel(to),
          from: hostLabel(from),
        }),
        confirmLabel: m["ws.copy"](),
      },
      () => onCopy?.(to) ?? Promise.resolve(),
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          title={blocked || m["ws.menu"]({ workspace })}
          aria-label={m["ws.menu"]({ workspace })}
          disabled={busy || Boolean(blocked)}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreVertical className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {onCopy &&
          moveTargets.map((to) => (
            <DropdownMenuItem
              key={`copy-${to}`}
              className="gap-2 text-xs"
              onSelect={() => void copy(to)}
            >
              <Copy className="h-3.5 w-3.5" />
              {m["ws.copyTo"]({ server: hostLabel(to) })}
            </DropdownMenuItem>
          ))}
        {moveTargets.map((to) => (
          <DropdownMenuItem
            key={to}
            className="gap-2 text-xs"
            onSelect={() => void move(to)}
          >
            <CloudUpload className="h-3.5 w-3.5" />
            {m["ws.moveTo"]({ server: hostLabel(to) })}
          </DropdownMenuItem>
        ))}
        {/* In red: the one act on this row that cannot be undone at all. */}
        <DropdownMenuItem
          className="gap-2 text-destructive text-xs"
          onSelect={() => void remove()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {m["common.remove"]()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
