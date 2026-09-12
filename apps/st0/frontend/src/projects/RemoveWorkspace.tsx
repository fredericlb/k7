// RemoveWorkspace.tsx — take a workspace off this machine: the folder and everything in it.
//
// Not the same act as deleting a project, which recycles: the bin lives INSIDE a workspace, so a
// workspace has nowhere to fall into and this is final. The confirmation therefore says which of
// the two kinds it is looking at, because only one of them is re-cloneable.
// See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import { askConfirm } from "@studio/project-shell/ask";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { m } from "../paraglide/messages.js";

export function RemoveWorkspace({
  workspace,
  /** Its git remote, or null — what decides whether this is reversible by re-cloning. */
  origin,
  blocked,
  onRemove,
}: {
  workspace: string;
  origin: string | null;
  blocked: string;
  onRemove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const agreed = await askConfirm({
      title: m["ws.removeTitle"]({ workspace }),
      body: origin
        ? m["ws.removeBodyRepo"]({ origin })
        : m["ws.removeBodyLocal"](),
      confirmLabel: m["common.remove"](),
      danger: true,
    });
    if (!agreed) return;
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="xs"
      className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
      disabled={busy || Boolean(blocked)}
      title={blocked || m["ws.removeHint"]({ workspace })}
      onClick={() => void ask()}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
