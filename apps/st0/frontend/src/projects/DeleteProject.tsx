// DeleteProject.tsx — the small text button beside a project, and its confirmation. Naming the
// project IN the question is what makes the confirmation useful: "are you sure?" does not say of
// what. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Loader2 } from "lucide-react";
import { useState } from "react";

export function DeleteProject({
  /** The project's path in the repository — what is deleted, and what the question names. */
  path,
  label,
  blocked,
  onDelete,
}: {
  path: string;
  label: string;
  blocked: string;
  onDelete: (onStep: (s: string) => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    setBusy(true);
    setError("");
    void onDelete(setStep)
      .then(() => setOpen(false))
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setStep("");
      });
  };

  return (
    <>
      {/* Discret : c'est une action rare et destructrice, elle n'a pas à concurrencer du
          regard le clic qui OUVRE le projet, lequel est le geste courant sur cette ligne. */}
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
        disabled={Boolean(blocked)}
        title={blocked || `Supprimer ${label}`}
        onClick={(e) => {
          // The whole row is a link to the project: without this, deleting would open it.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Supprimer
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Supprimer « {label} » ?</DialogTitle>
            <DialogDescription>
              Le dossier est retiré du dépôt sur la machine, puis le commit est
              poussé. Les autres machines le perdront à leur prochain
              rafraîchissement.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded bg-muted px-3 py-2 font-mono text-xs">{path}</p>
          {/* Ce que le git rend récupérable, dit sans le survendre : l'historique garde le
              contenu, ce qui n'est pas la même chose qu'un bouton « annuler ». */}
          <p className="text-xs text-muted-foreground">
            Le contenu reste dans l'historique git du dépôt.
          </p>

          {step && (
            <p className="text-xs text-muted-foreground">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              {step}
            </p>
          )}
          {error && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Annuler
            </Button>
            <Button variant="destructive" disabled={busy} onClick={submit}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
