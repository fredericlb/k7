// NewProject.tsx — "Nouveau projet" inside a repository's block: the archetype, the name, and the
// derived folder shown BEFORE creating — as AddSong shows the tree before uploading, because here
// too the name decides everything. See ../../docs/projects.md.

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
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { FolderPlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { projectFolderName } from "./projectName";

/**
 * The three ARCHETYPES — one row, where there used to be two.
 *
 * The upper row chose the APPLICATION, and so the folder's suffix. There is only one app now, so
 * that question has no answers left to pick between, and what tells these three apart is a
 * TEMPLATE rather than an application.
 *
 * Each is named after the SURFACE it opens on, because that is exactly what is being chosen: a
 * project is no longer distinguished by what it IS — everything is a `.st0` — but by the screen
 * it declares (packages/song/docs/surfaces.md). A fourth existed, `live`: the graph alone, no
 * surface. It went with this naming, an entry whose whole description is "none of the three"
 * being nothing anybody picks on purpose. The `live` MODE remains, and a mix declares it.
 *
 * See `PROJECT_SHAPES` in @studio/song.
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
  /** Why it is impossible, or "" — an offline machine is the ordinary state. */
  blocked,
  onCreate,
}: {
  blocked: string;
  /** Returns when done. `onStep` narrates the wait: cloning takes tens of seconds, and a screen
   *  saying nothing for that long looks frozen. */
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

  // One suffix is left, and this is it: every shape lives in a `.st0` folder.
  const { folder, error: badName } = projectFolderName(name, "st0");

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
            {/* The archetype decides the TEMPLATE written in the folder. The suffix is no
                longer a choice — there is only one. */}
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

            {/* What will actually be created, before confirming. A refused name says so here
                rather than after a round trip to the machine. */}
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
