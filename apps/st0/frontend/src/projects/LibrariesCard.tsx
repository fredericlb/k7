// LibrariesCard.tsx — le dépôt des bibliothèques : les modules et les chaînes que TOUS les
// projets du compte héritent, montés dans chaque espace de travail en sous-module git. En tête
// de la section parce que sans lui l8 refuse d'ouvrir quoi que ce soit.
// Voir packages/song/docs/sharedFolders.md et packages/project-shell/docs/launch.md.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import type { RepoRef } from "@studio/web-protocol";
import { LibraryBig, Loader2, Pencil, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { projects } from "../api";

export function LibrariesCard() {
  // `undefined` = pas encore lu, `null` = lu et il n'y en a pas. Les deux se dessinent
  // différemment : un compte neuf doit lire « il en faut un », pas un vide de chargement.
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
        // Sans dépôt, la carte n'est pas une ligne d'information : c'est la seule chose à
        // faire sur cet écran, et rien d'autre ici ne marchera tant qu'elle n'est pas faite.
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
            sans lui, l8 refuse d'ouvrir un projet, parce qu'aucune référence{" "}
            <code>@st0/…</code> ne résoudrait.
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

      {/* Changer de dépôt ne touche AUCUNE machine : le sous-module déjà cloné dans un espace
          de travail pointe toujours sur l'ancien. Dit ici parce que c'est le seul endroit où
          quelqu'un peut le provoquer, et que rien ne le rattrapera tout seul. */}
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
