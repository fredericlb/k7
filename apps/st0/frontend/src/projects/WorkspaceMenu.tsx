// WorkspaceMenu.tsx — the ⋮ at the end of a workspace's row: publish, compact, delete. The two
// destructive acts are confirmed through `askConfirm`, which says what each one loses; the publish
// dialog is mounted HERE, outside the menu, since a Radix menu unmounts its content on select.
// See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  Archive,
  Loader2,
  MoreVertical,
  Trash2,
  Upload,
} from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { PublishWorkspace } from "./PublishWorkspace";

export function WorkspaceMenu({
  workspace,
  origin,
  blocked,
  onPublish,
  onCompact,
  onRemove,
}: {
  workspace: string;
  /** Its git remote, or null — what decides whether Publish is offered and what the confirmations say. */
  origin: string | null;
  /** Why nothing here can run — no file service, or one busy. Empty when it can. */
  blocked: string;
  onPublish: (uri: string, onStep: (s: string) => void) => Promise<void>;
  onCompact: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [publishing, setPublishing] = useState(false);
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

  const compact = () =>
    confirmThen(
      {
        title: m["ws.compactTitle"]({ workspace }),
        body: origin
          ? m["ws.compactBodyRepo"]({ origin })
          : m["ws.compactBodyLocal"](),
        confirmLabel: m["ws.compact"](),
        danger: true,
      },
      onCompact,
    );

  const remove = () =>
    confirmThen(
      {
        title: m["ws.removeTitle"]({ workspace }),
        body: origin
          ? m["ws.removeBodyRepo"]({ origin })
          : m["ws.removeBodyLocal"](),
        confirmLabel: m["common.remove"](),
        danger: true,
      },
      onRemove,
    );

  return (
    <>
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
          {/* A workspace with no repository has one gesture the others do not: getting one. */}
          {!origin && (
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={() => setPublishing(true)}
            >
              <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              {m["ws.publish"]()}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="gap-2 text-xs"
            title={m["ws.compactHint"]()}
            onSelect={() => void compact()}
          >
            <Archive className="h-3.5 w-3.5 text-muted-foreground" />
            {m["ws.compact"]()}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Last, and the only one in red: the one act on this row that cannot be undone at all. */}
          <DropdownMenuItem
            className="gap-2 text-destructive text-xs"
            onSelect={() => void remove()}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {m["common.remove"]()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {!origin && (
        <PublishWorkspace
          open={publishing}
          onClose={() => setPublishing(false)}
          workspace={workspace}
          onPublish={onPublish}
        />
      )}
    </>
  );
}
