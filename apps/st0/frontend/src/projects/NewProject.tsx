// NewProject.tsx — « Nouveau projet » dans le bloc d'un dépôt : le type, le nom, et le dossier
// déduit montré AVANT de créer — comme AddSong montre l'arborescence avant l'envoi, parce
// qu'ici aussi c'est le nom qui décide de tout. Voir ../../docs/projects.md.

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
import {
  PROJECT_SUFFIXES,
  type ProjectApp,
} from "@studio/web-protocol/projects";
import { FolderPlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { projectFolderName } from "./projectName";

/** Les applications qui possèdent des projets. k7 et z0 n'en ont pas — c'est `ProjectApp` qui
 *  le dit, et ce menu ne fait que le refléter. */
const APPS = Object.keys(PROJECT_SUFFIXES) as ProjectApp[];

export function NewProject({
  /** Pourquoi c'est impossible, ou "" — une machine hors ligne est l'état ordinaire. */
  blocked,
  onCreate,
}: {
  blocked: string;
  /** Rend la main quand c'est fait. `onStep` sert à raconter l'attente : cloner un dépôt prend
   *  des dizaines de secondes, et un écran qui ne dit rien pendant ce temps semble figé. */
  onCreate: (folder: string, onStep: (s: string) => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [app, setApp] = useState<ProjectApp>("l8");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const { folder, error: badName } = projectFolderName(name, app);

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
        variant="secondary"
        size="xs"
        disabled={Boolean(blocked)}
        title={blocked || "Créer un projet dans ce dépôt"}
        onClick={() => setOpen(true)}
      >
        <FolderPlus className="mr-1 h-3.5 w-3.5" /> Nouveau projet
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nouveau projet</DialogTitle>
            <DialogDescription>
              Le projet est créé sur la machine choisie, avec les réglages par
              défaut, puis committé et poussé.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {/* Le type d'abord : c'est lui qui décide du suffixe, donc de l'application qui
                ouvrira le dossier, donc de ce que le nom en dessous va donner. */}
            <div className="flex items-center gap-2">
              {APPS.map((a) => (
                <Button
                  key={a}
                  type="button"
                  size="sm"
                  variant={app === a ? "default" : "secondary"}
                  disabled={busy}
                  onClick={() => setApp(a)}
                >
                  {a}
                </Button>
              ))}
              <span className="text-xs text-muted-foreground">
                {app === "l8"
                  ? "l'éditeur complet, avec la timeline"
                  : app === "v1"
                    ? "le montage : un viewport et ses pistes, en secondes"
                    : app === "z0"
                      ? "un blind-test"
                      : "mix, édition et graphe — sans la timeline"}
              </span>
            </div>

            <Input
              autoFocus
              placeholder="nom du projet — « hiver »"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />

            {/* Ce qui sera réellement créé, avant de valider. Un nom refusé le dit ici plutôt
                qu'après un aller-retour jusqu'à la machine. */}
            <p className="font-mono text-xs text-muted-foreground">
              {badName ? (
                <span className="text-destructive">{badName}</span>
              ) : folder ? (
                folder
              ) : (
                " "
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
