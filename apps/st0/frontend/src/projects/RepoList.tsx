// RepoList.tsx — les dépôts git de la personne connectée : en ajouter un par URI SSH, en
// retirer, en rafraîchir. Présentationnel : la section détient l'asynchrone et ce fichier
// dessine. Voir ../../docs/projects.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import type { RepoSummary } from "@studio/web-protocol";
import {
  FolderGit2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

export function RepoList({
  repos,
  busy,
  error,
  onAdd,
  onOpen,
  onRemove,
  onRefresh,
}: {
  repos: RepoSummary[];
  busy: boolean;
  error: string | null;
  onAdd: (uri: string) => void;
  onOpen: (repo: RepoSummary) => void;
  onRemove: (repo: RepoSummary) => void;
  onRefresh: (repo: RepoSummary) => void;
}) {
  const [uri, setUri] = useState("");
  const add = () => {
    const v = uri.trim();
    if (v) {
      onAdd(v);
      setUri("");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
          placeholder="git@hôte:utilisateur/depot.git — URI SSH uniquement"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={add}
          disabled={!uri.trim()}
        >
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </div>

      {error && (
        <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}

      {repos.length === 0 ? (
        <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </span>
          ) : (
            <>
              Aucun dépôt. Collez une URI SSH ci-dessus — et pensez à ajouter la
              clé de déploiement chez votre hébergeur git d'abord.
            </>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {repos.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => onOpen(r)}
              >
                <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{r.label}</span>
                    {/* null n'est pas 0 : « on ne sait pas encore » et « aucun projet » diffèrent. */}
                    {r.projectCount !== null && (
                      <Badge variant={r.projectCount ? "tag" : "default"}>
                        {r.projectCount} projet
                        {r.projectCount === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {r.branch && (
                      <span className="text-xs text-muted-foreground">
                        {r.branch}
                      </span>
                    )}
                    {r.fetching && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.uri}
                  </span>
                  {/* Le message de git, tel quel : « Permission denied (publickey) » est la réponse entière. */}
                  {r.error && (
                    <span className="mt-1 flex items-start gap-1 text-xs text-amber-500">
                      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="whitespace-pre-wrap">{r.error}</span>
                    </span>
                  )}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Récupérer les nouveautés"
                  onClick={() => onRefresh(r)}
                  disabled={r.fetching}
                >
                  <RefreshCw
                    className={r.fetching ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Retirer ce dépôt de la liste"
                  onClick={() => onRemove(r)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
