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
      title: `Retirer « ${workspace} » de cette machine ?`,
      body: origin
        ? `Le dossier et tout ce qu'il contient sont supprimés. Le dépôt reste chez son ` +
          `hébergeur (${origin}) : ce qui a été poussé se récupère en l'important à nouveau, ` +
          `ce qui ne l'a pas été s'en va avec le dossier.`
        : `Le dossier et tout ce qu'il contient sont supprimés. Cet espace de travail n'a ` +
          `AUCUN dépôt derrière lui : il n'existe que sur cette machine, et rien ne le ramènera.`,
      confirmLabel: "Retirer",
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
      title={blocked || `Retirer ${workspace} de cette machine`}
      onClick={() => void ask()}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
