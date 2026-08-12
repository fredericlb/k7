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
import type { ProjectMode } from "@studio/engine-protocol/project";
import {
  type ProjectApp,
  SCAFFOLDED_APPS,
} from "@studio/web-protocol/projects";
import { FolderPlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { projectFolderName } from "./projectName";

/**
 * Les applications pour lesquelles on peut CRÉER un projet.
 *
 * Pas `PROJECT_SUFFIXES` : z0 possède bien les dossiers `.z0`, mais aucun gabarit ne sait en
 * écrire un. Le proposer ici fabriquait un dossier `.z0` contenant une chanson l8 — le suffixe
 * disait une chose, le contenu une autre, et personne ne s'en plaignait avant que z0 l'ouvre.
 * `SCAFFOLDED_APPS` est la liste qui répond à la bonne question ; voir
 * packages/web-protocol/projects.ts.
 */
const APPS = SCAFFOLDED_APPS;

/** Une ligne pour dire ce qu'on est en train de créer — le suffixe seul ne le dit pas. */
const WHAT: Record<ProjectApp, string> = {
  l8: "l'éditeur complet — son et image",
  m9: "mix, édition et graphe — sans la timeline",
  // Jamais affiché (z0 n'est pas dans APPS), mais le Record force à répondre pour chaque app :
  // c'est ce qui fera échouer la compilation le jour où z0 gagne un gabarit.
  z0: "un blind-test",
};

/**
 * Les deux formes d'un projet l8 — un second choix, et seulement pour l8.
 *
 * Il ne peut pas passer par le menu du dessus : celui-là choisit le SUFFIXE, donc l'application
 * qui ouvrira le dossier, et les deux formes habitent le même `.l8` et s'ouvrent dans la même
 * application. Deux rangées, donc, parce que ce sont deux questions.
 *
 * Attention à la ligne de m9 juste au-dessus : « sans la timeline » y décrit une AUTRE
 * application. Ici, `live` est l8 sans sa timeline, et ce qui les sépare est que m9 a des platines
 * et une liste de morceaux là où un projet live n'a que son graphe.
 */
const MODES: { id: ProjectMode; label: string; what: string }[] = [
  {
    id: "arrangement",
    label: "arrangement",
    what: "une chanson : la timeline au-dessus du graphe",
  },
  {
    id: "live",
    label: "live",
    what: "un rig : le graphe seul, pas de timeline",
  },
];

export function NewProject({
  /** Pourquoi c'est impossible, ou "" — une machine hors ligne est l'état ordinaire. */
  blocked,
  onCreate,
}: {
  blocked: string;
  /** Rend la main quand c'est fait. `onStep` sert à raconter l'attente : cloner un dépôt prend
   *  des dizaines de secondes, et un écran qui ne dit rien pendant ce temps semble figé.
   *  `mode` n'est envoyé que pour l8 — voir MODES. */
  onCreate: (
    folder: string,
    onStep: (s: string) => void,
    mode?: ProjectMode,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [app, setApp] = useState<ProjectApp>("l8");
  // Gardé en dehors de `app` : revenir à l8 après un détour par m9 retrouve la forme choisie,
  // plutôt que de la remettre en silence sur `arrangement`.
  const [mode, setMode] = useState<ProjectMode>("arrangement");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const { folder, error: badName } = projectFolderName(name, app);

  const submit = () => {
    if (!folder || busy) return;
    setBusy(true);
    setError("");
    setStep("");
    // Seulement pour l8 : m9 n'a pas cet axe, et lui envoyer une valeur donnerait à
    // croire que le service en fait quelque chose.
    void onCreate(folder, setStep, app === "l8" ? mode : undefined)
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
              <span className="text-xs text-muted-foreground">{WHAT[app]}</span>
            </div>

            {/* La forme, pour l8 seulement. Absente pour m9 plutôt que grisée : une rangée
                grise invite à se demander ce qu'on a mal fait, alors qu'il n'y a rien à choisir. */}
            {app === "l8" && (
              <div className="flex items-center gap-2">
                {MODES.map((md) => (
                  <Button
                    key={md.id}
                    type="button"
                    size="sm"
                    variant={mode === md.id ? "default" : "secondary"}
                    disabled={busy}
                    onClick={() => setMode(md.id)}
                  >
                    {md.label}
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground">
                  {MODES.find((md) => md.id === mode)?.what}
                </span>
              </div>
            )}

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
