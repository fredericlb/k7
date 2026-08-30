// NewWorkspace.tsx — the gesture that needs no server at all: a workspace of one's own, git
// initialised on the machine with NO repository behind it. It holds nothing yet, deliberately —
// which archetype the first project takes is a question the editor asks on the empty workspace,
// where the answer is about to be looked at. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Input } from "@frediverse/ui/input";
import { HardDrive, Loader2 } from "lucide-react";
import { useState } from "react";
import { workspaceFolderName } from "./projectName";

export function NewWorkspace({
  /** Why it is impossible, or "" — an offline machine is the ordinary state. */
  blocked,
  onCreate,
}: {
  blocked: string;
  onCreate: (workspace: string, onStep: (s: string) => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const { folder, error: badName } = workspaceFolderName(name);

  const submit = () => {
    if (!folder || busy) return;
    setBusy(true);
    setError("");
    setStep("");
    void onCreate(folder, setStep)
      .then(() => {
        setOpen(false);
        setName("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setStep("");
      });
  };

  return (
    <>
      <Button
        size="sm"
        disabled={Boolean(blocked)}
        title={blocked || "Créer un espace de travail sur cette machine"}
        onClick={() => setOpen(true)}
      >
        <HardDrive className="mr-1 h-4 w-4" /> Nouveau
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nouvel espace de travail</DialogTitle>
            <DialogDescription>
              Créé sur la machine, versionné par git, et sans dépôt distant. Il
              n'y a rien à configurer : le premier projet se choisit en
              l'ouvrant, le dépôt se demande le jour où vous publiez.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              placeholder="nom — « hiver »"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />

            {/* The folder, before confirming: a refused name says so here rather than after a round trip. */}
            <p className="font-mono text-xs text-muted-foreground">
              {badName ? (
                <span className="text-destructive">{badName}</span>
              ) : (
                folder || " "
              )}
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
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Annuler
            </Button>
            <Button disabled={busy || !folder} onClick={submit}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
