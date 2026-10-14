// WorkspaceMenu.tsx — the ⋮ at the end of a workspace's row: delete it. The act is confirmed
// through `askConfirm`, which says what it loses. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Loader2, MoreVertical, Trash2 } from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import { useState } from "react";
import { m } from "../paraglide/messages.js";

export function WorkspaceMenu({
  workspace,
  blocked,
  onRemove,
}: {
  workspace: string;
  /** Why nothing here can run — no file service, or one busy. Empty when it can. */
  blocked: string;
  onRemove: () => Promise<void>;
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
          {m["common.remove"]()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
