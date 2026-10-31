// WorkspaceMenu.tsx — the ⋮ at the end of a workspace's row: delete it, which asks for the workspace's NAME.
// See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Loader2, MoreVertical, Trash2 } from "@frediverse/ui/icons";
import { askText } from "@studio/project-shell/ask";
import { useState } from "react";
import { m } from "../paraglide/messages.js";

export function WorkspaceMenu({
  workspace,
  blocked,
  onRemove,
  projectCount = 0,
}: {
  workspace: string;
  /** How many projects the delete takes with it — said in the confirmation. */
  projectCount?: number;
  /** Why nothing here can run — no file service, or one busy. Empty when it can. */
  blocked: string;
  onRemove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

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
