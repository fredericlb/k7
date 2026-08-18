// NewProject.tsx — « Nouveau projet » dans le bloc d'un dépôt : l'archétype, le nom, et le
// dossier déduit montré AVANT de créer — comme AddSong montre l'arborescence avant l'envoi,
// parce qu'ici aussi c'est le nom qui décide de tout. Voir ../../docs/projects.md.

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
import type { ProjectShape } from "@studio/song/yaml/projectSchema";
import { FolderPlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { projectFolderName } from "./projectName";

/**
 * Les trois ARCHÉTYPES — une seule rangée, là où il y en avait deux.
 *
 * La rangée du dessus choisissait l'APPLICATION, donc le suffixe du dossier : `.l8`, `.m9`.
 * Il n'y en a plus qu'une, donc cette question n'a plus de réponses à départager — et ce qui
 * distingue ces trois-là est un GABARIT, pas une application. Les deux rangées n'en font donc
 * plus qu'une.
 *
 * Chacun porte le nom de la SURFACE sur laquelle il s'ouvre, parce que c'est exactement ce
 * qu'on choisit ici : un projet ne se distingue plus par ce qu'il EST — tout est un `.l8` — mais
 * par l'écran qu'il déclare (packages/song/docs/surfaces.md). Un quatrième existait, « live » :
 * le graphe seul, aucune surface. Il est parti avec ce nommage, une entrée dont la description
 * entière est « aucune des trois » n'étant pas un choix qu'on fait exprès. Le MODE `live`, lui,
 * reste — c'est ce que déclare un mix.
 *
 * z0 possède bien les dossiers `.z0` et n'a aucun gabarit : il n'a jamais eu sa place ici, et
 * n'en a plus besoin d'une. Voir `PROJECT_SHAPES` dans @studio/song.
 */
const SHAPES: { id: ProjectShape; label: string; what: string }[] = [
  {
    id: "arrangement",
    label: "arrangement",
    what: "la timeline au-dessus du graphe — une piste, un synthé, un motif",
  },
  {
    id: "mix",
    label: "mix",
    what: "deux platines, un crossfade, et une liste de morceaux vide",
  },
  {
    id: "video",
    label: "vidéo",
    what: "la timeline et le viewport — l'arrangement, plus une piste d'image",
  },
];

export function NewProject({
  /** Pourquoi c'est impossible, ou "" — une machine hors ligne est l'état ordinaire. */
  blocked,
  onCreate,
}: {
  blocked: string;
  /** Rend la main quand c'est fait. `onStep` sert à raconter l'attente : cloner un dépôt prend
   *  des dizaines de secondes, et un écran qui ne dit rien pendant ce temps semble figé. */
  onCreate: (
    folder: string,
    onStep: (s: string) => void,
    shape: ProjectShape,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shape, setShape] = useState<ProjectShape>("arrangement");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  // Un seul suffixe reste, et c'est celui-là : toute forme habite un dossier `.l8`.
  const { folder, error: badName } = projectFolderName(name, "l8");

  const submit = () => {
    if (!folder || busy) return;
    setBusy(true);
    setError("");
    setStep("");
    void onCreate(folder, setStep, shape)
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
            {/* L'archétype : il décide du GABARIT écrit dans le dossier. Le suffixe, lui, ne
                se choisit plus — il n'y en a qu'un. */}
            <div className="flex items-center gap-2">
              {SHAPES.map((sh) => (
                <Button
                  key={sh.id}
                  type="button"
                  size="sm"
                  variant={shape === sh.id ? "default" : "secondary"}
                  disabled={busy}
                  onClick={() => setShape(sh.id)}
                >
                  {sh.label}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {SHAPES.find((sh) => sh.id === shape)?.what}
            </span>

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
