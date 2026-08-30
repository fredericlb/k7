// CopyProject.tsx — the small text button beside a project, and the dialog that picks where the
// copy lands. The DESTINATION is what decides whether anything is pushed, so each row says which
// of the two it is before the click rather than after. See ../../docs/projects.md.

import { Badge } from "@frediverse/ui/badge";
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
import type { MachineWorkspace } from "@studio/web-protocol";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { Copy, FolderGit2, HardDrive, Loader2 } from "lucide-react";
import { useState } from "react";
import { projectFolderName } from "./projectName";

export function CopyProject({
  path,
  label,
  /** The source's app: the copy keeps the suffix, or another application would claim it. */
  app,
  blocked,
  targets,
  onCopy,
}: {
  path: string;
  label: string;
  app: ProjectApp;
  blocked: string;
  /** Where it may land — every OTHER workspace on this machine that holds several projects. */
  targets: MachineWorkspace[];
  onCopy: (
    to: MachineWorkspace,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<MachineWorkspace | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const { folder, error: badName } = projectFolderName(name, app);
  // Said on the button rather than found on click, as everywhere else on this page.
  const why =
    blocked ||
    (targets.length ? "" : "aucun autre espace de travail où copier");

  const submit = () => {
    if (!folder || !to || busy) return;
    setBusy(true);
    setError("");
    setStep("");
    void onCopy(to, folder, setStep)
      .then(() => setOpen(false))
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setStep("");
      });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-xs text-muted-foreground"
        disabled={Boolean(why)}
        title={why || `Copier ${label} vers un autre espace de travail`}
        onClick={(e) => {
          // The whole row is a link to the project: without this, copying would open it.
          e.preventDefault();
          e.stopPropagation();
          setName(label);
          setTo(null);
          setError("");
          setOpen(true);
        }}
      >
        Copier
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Copier « {label} »</DialogTitle>
            <DialogDescription>
              Le dossier est copié dans l'espace de travail choisi, puis
              committé là-bas — et poussé si cet espace a un dépôt. L'original
              n'est pas touché.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded bg-muted px-3 py-2 font-mono text-xs">{path}</p>

          <div className="flex max-h-48 flex-col gap-1 overflow-auto">
            {targets.map((w) => (
              <button
                key={w.name}
                type="button"
                disabled={busy}
                className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                  to?.name === w.name ? "bg-accent" : "hover:bg-accent/50"
                }`}
                onClick={() => setTo(w)}
              >
                {w.origin ? (
                  <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{w.name}</span>
                {/* The one thing that changes what the copy DOES, said per row. */}
                <Badge variant={w.origin ? "tag" : "default"}>
                  {w.origin ? "commit et envoi" : "commit seulement"}
                </Badge>
              </button>
            ))}
          </div>

          <Input
            placeholder="nom de la copie"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />

          {/* What will actually be created, before confirming — as in NewProject, the name decides everything. */}
          <p className="font-mono text-xs text-muted-foreground">
            {badName ? (
              <span className="text-destructive">{badName}</span>
            ) : folder && to ? (
              `${to.name} / ${folder}`
            ) : (
              " "
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

          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Annuler
            </Button>
            <Button disabled={busy || !folder || !to} onClick={submit}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              <Copy className="mr-1 h-3.5 w-3.5" /> Copier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
