// LibrariesCard.tsx — the libraries repository: the modules and chains EVERY project on the
// account inherits, mounted in each workspace as a git submodule. At the head of the section
// because without it st0 refuses to open anything.
// Voir packages/song/docs/sharedFolders.md et packages/project-shell/docs/launch.md.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import type { RepoRef } from "@studio/web-protocol";
import { LibraryBig, Loader2, Pencil, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { projects } from "./api";

export function LibrariesCard() {
  // `undefined` = not read yet, `null` = read and there is none: a new account must read 'you need one', not a loading blank.
  const [repo, setRepo] = useState<RepoRef | null | undefined>(undefined);
  const [uri, setUri] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void projects
      .libraries()
      .then((r) => setRepo(r.libraries))
      .catch((e: Error) => {
        setError(e.message);
        setRepo(null);
      });
  }, []);

  const save = () => {
    const v = uri.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    void projects
      .setLibraries(v)
      .then((r) => {
        setRepo(r.libraries);
        setUri("");
        setEditing(false);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (repo === undefined)
    return (
      <div className="flex items-center gap-2 border-b px-6 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lecture du dépôt des
        bibliothèques…
      </div>
    );

  const missing = !repo;
  const form = missing || editing;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b px-6 py-4",
        // With no repository the card is not an information row: it is the one thing to do here, and nothing else works until it is done.
        missing && "border-b-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {missing ? (
          <TriangleAlert className="h-4 w-4 text-amber-500" />
        ) : (
          <LibraryBig className="h-4 w-4" />
        )}
        Bibliothèques
        {!missing && !editing && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setUri(repo.uri);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> Changer
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {missing ? (
          <>
            Les modules et les chaînes partagés vivent dans un dépôt git, monté
            dans chaque espace de travail en sous-module. <b>Il en faut un</b> :
            sans lui, st0 refuse d'ouvrir un projet, parce qu'aucune référence{" "}
            <code>@st0/…</code> ne résoudrait. Un dépôt <b>vide</b> convient —
            le catalogue déjà là y sera recopié à la première ouverture d'un
            projet.
          </>
        ) : (
          <>
            Les modules et les chaînes que tous vos projets héritent. Montées
            dans chaque espace de travail en sous-module — ce que vous y
            committez suit le dépôt, pas le morceau.
          </>
        )}
      </p>

      {form ? (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
            placeholder="git@hôte:utilisateur/bibliotheques.git — URI SSH uniquement"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <Button size="sm" onClick={save} disabled={busy || !uri.trim()}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {missing ? "Ajouter" : "Remplacer"}
          </Button>
          {editing && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditing(false);
                setUri("");
              }}
            >
              Annuler
            </Button>
          )}
        </div>
      ) : (
        <code className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
          {repo.uri}
        </code>
      )}

      {/* Changing the repository touches NO machine: a submodule already cloned into a workspace still points at the old one. */}
      {editing && !missing && (
        <p className="text-xs text-amber-500">
          Les espaces de travail déjà présents sur une machine gardent l'ancien
          dépôt : leur sous-module y pointe toujours, et il faudra l'y changer à
          la main.
        </p>
      )}

      {error && (
        <code className="rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}
    </div>
  );
}
