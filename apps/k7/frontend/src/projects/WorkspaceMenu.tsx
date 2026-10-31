// WorkspaceMenu.tsx — the ⋮ at the end of a workspace's row: copy or move it to another link, or delete it.
// Each is confirmed in words; the delete asks for the workspace's NAME. See ../../docs/projects.md.

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
import { askConfirm, askText } from "@studio/project-shell/ask";
import { useState } from "react";
import { m } from "../paraglide/messages.js";

/** A link it may go to: `ref` is what the backend takes, `label` what the person reads. */
export interface MoveTarget {
  ref: string;
  label: string;
}

export function WorkspaceMenu({
  workspace,
  blocked,
  onRemove,
  moveTargets = [],
  from = "",
  onMove,
  onCopy,
  projectCount = 0,
}: {
  workspace: string;
  /** How many projects the delete takes with it — said in the confirmation. */
  projectCount?: number;
  /** Why nothing here can run — no file service, or one busy. Empty when it can. */
  blocked: string;
  onRemove: () => Promise<void>;
  /** The other links it may be copied or moved to; none draws no entry. */
  moveTargets?: MoveTarget[];
  /** The link it syncs with now, as the confirmation names it. */
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

  // The one act here that cannot be undone, so it asks for the NAME rather than a click a habit could give.
  const remove = async () => {
    const typed = await askText({
      title: m["ws.removeTitle"]({ workspace }),
      body: m["ws.removeBody"]({ count: String(projectCount) }),
      placeholder: workspace,
      confirmLabel: m["ws.delete"](),
      validate: (v) => (v.trim() === workspace ? "" : m["ws.typeName"]()),
    });
    if (typed?.trim() !== workspace) return;
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  };

  const move = (to: MoveTarget) =>
    confirmThen(
      {
        title: m["ws.moveTitle"]({ workspace, server: to.label }),
        body: m["ws.moveBody"]({ server: to.label, from }),
        confirmLabel: m["ws.move"](),
      },
      () => onMove?.(to.ref) ?? Promise.resolve(),
    );

  const copy = (to: MoveTarget) =>
    confirmThen(
      {
        title: m["ws.copyTitle"]({ workspace, server: to.label }),
        body: m["ws.copyBody"]({ server: to.label, from }),
        confirmLabel: m["ws.copy"](),
      },
      () => onCopy?.(to.ref) ?? Promise.resolve(),
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
              key={`copy-${to.ref}`}
              className="gap-2 text-xs"
              onSelect={() => void copy(to)}
            >
              <Copy className="h-3.5 w-3.5" />
              {m["ws.copyTo"]({ server: to.label })}
            </DropdownMenuItem>
          ))}
        {moveTargets.map((to) => (
          <DropdownMenuItem
            key={to.ref}
            className="gap-2 text-xs"
            onSelect={() => void move(to)}
          >
            <CloudUpload className="h-3.5 w-3.5" />
            {m["ws.moveTo"]({ server: to.label })}
          </DropdownMenuItem>
        ))}
        {/* In red: the one act on this row that cannot be undone at all. */}
        <DropdownMenuItem
          className="gap-2 text-destructive text-xs"
          onSelect={() => void remove()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {m["ws.deleteEllipsis"]()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
