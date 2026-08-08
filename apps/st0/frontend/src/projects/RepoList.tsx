// RepoList.tsx — les dépôts git de la personne connectée, chacun avec ses projets détectés
// en retrait : en ajouter un par URI SSH, en retirer, en rafraîchir, ou ouvrir un projet
// directement, dans un nouvel onglet. Présentationnel : la section détient l'asynchrone et
// ce fichier dessine. Voir ../../docs/projects.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import type { RepoProject, RepoSummary } from "@studio/web-protocol";
import {
  BENCH_PROJECT,
  BENCH_REPO,
  launchUrl,
  projectLabel,
} from "@studio/web-protocol/projects";
import {
  CornerDownRight,
  ExternalLink,
  FlaskConical,
  FolderGit2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { DeleteProject } from "./DeleteProject";
import { NewProject } from "./NewProject";

/** Le nom du dossier, sans son suffixe : `chansons/hiver.l8` s'affiche « hiver », et le
 *  chemin qui la situe dans le dépôt est à côté. */
const nameOf = (p: RepoProject): string =>
  projectLabel(p.path.split("/").pop() ?? p.path);

/** Le dossier qui contient le projet, ou null quand il est à la racine du dépôt. */
const parentOf = (p: RepoProject): string | null => {
  const cut = p.path.lastIndexOf("/");
  return cut > 0 ? p.path.slice(0, cut) : null;
};

export function RepoList({
  repos,
  busy,
  error,
  onAdd,
  onOpen,
  blocked,
  onCreate,
  onDelete,
  projectHref,
  onRemove,
  onRefresh,
}: {
  repos: RepoSummary[];
  busy: boolean;
  error: string | null;
  onAdd: (uri: string) => void;
  onOpen: (repo: RepoSummary) => void;
  /** Pourquoi créer et supprimer sont impossibles, ou "". Les deux passent par une machine
   *  moteur — st0 n'a qu'un miroir bare et sans blobs, voir ../../docs/projects.md. */
  blocked: string;
  onCreate: (
    repo: RepoSummary,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  onDelete: (
    repo: RepoSummary,
    project: RepoProject,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** L'adresse d'un projet dans SON application, sans passer par l'arborescence. Une adresse
   *  et non une action : la rangée est un lien, qui s'ouvre dans un nouvel onglet. */
  projectHref: (repo: RepoSummary, project: RepoProject) => string;
  onRemove: (repo: RepoSummary) => void;
  onRefresh: (repo: RepoSummary) => void;
}) {
  const [uri, setUri] = useState("");
  // Une ADRESSE, calculée ici comme celle de tout autre projet — le dépôt réservé `@banc`
  // dit au portail de l8 de prendre l'autre route. Voir packages/web-protocol/projects.ts.
  const benchHref = launchUrl(
    window.location.origin,
    BENCH_REPO,
    BENCH_PROJECT,
    "l8",
  );
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

      {/* Le banc d'essai : un projet l8 sans dépôt, régénéré depuis le catalogue à chaque
          ouverture, où l'on essaie les modules et où on les CONSTRUIT — c'est le seul projet
          qui écrive dans la médiathèque. Une ancre comme toutes les autres ouvertures de projet
          ici (voir ../../docs/projects.md), donc ctrl-clic et « copier l'adresse » marchent.
          Grisé sans machine joignable : il faut une machine pour y récupérer le catalogue. */}
      <div className="flex items-center gap-3 rounded-md border border-dashed border-border p-3">
        <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Banc d'essai des modules</div>
          <p className="text-xs text-muted-foreground">
            Un projet l8 avec le catalogue entier dedans. Câblez un module dans
            la chaîne pour l'entendre — et ce que vous y modifiez est écrit dans
            la médiathèque, pas dans une copie.
          </p>
        </div>
        {blocked ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {blocked}
          </span>
        ) : (
          <Button variant="secondary" size="sm" asChild>
            <a href={benchHref} target="_blank" rel="noopener">
              <ExternalLink className="h-4 w-4" /> Ouvrir
            </a>
          </Button>
        )}
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
              className="flex flex-col rounded-md border border-border p-3"
            >
              <div className="flex items-center justify-between gap-3">
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
                      {r.projects !== null && (
                        <Badge variant={r.projects.length ? "tag" : "default"}>
                          {r.projects.length} projet
                          {r.projects.length === 1 ? "" : "s"}
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
                  {/* Dans le bloc du dépôt, à côté de ses deux autres actions : créer un
                      projet est une opération SUR ce dépôt, pas sur la liste. */}
                  <NewProject
                    blocked={blocked}
                    onCreate={(folder, onStep) => onCreate(r, folder, onStep)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Récupérer les nouveautés"
                    onClick={() => onRefresh(r)}
                    disabled={r.fetching}
                  >
                    <RefreshCw
                      className={
                        r.fetching ? "h-4 w-4 animate-spin" : "h-4 w-4"
                      }
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
              </div>

              {/* Les projets détectés, en retrait sous leur dépôt : c'est ce qu'on vient
                  chercher ici, et un clic va droit dans l'application qui l'ouvre — dans un
                  nouvel onglet, la médiathèque restant ce à quoi on revient. Le nom du dépôt
                  reste cliquable pour l'arborescence, qui montre tout le reste. */}
              {r.projects && r.projects.length > 0 && (
                <ul className="mt-2 flex flex-col border-l border-border pl-3 ml-2">
                  {r.projects.map((p) => (
                    // La rangée tient le lien ET le bouton : le lien s'étire, le bouton
                    // reste au bout, et le `preventDefault` de celui-ci l'empêche d'ouvrir.
                    <li key={p.path} className="flex items-center gap-1">
                      <a
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent/50"
                        title={`Ouvrir ${p.path} dans ${p.app}`}
                        href={projectHref(r, p)}
                        target="_blank"
                        rel="noopener"
                      >
                        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{nameOf(p)}</span>
                        <Badge variant="tag">{p.app}</Badge>
                        {parentOf(p) && (
                          <span className="truncate text-xs text-muted-foreground">
                            {parentOf(p)}
                          </span>
                        )}
                      </a>
                      <DeleteProject
                        path={p.path}
                        label={nameOf(p)}
                        blocked={blocked}
                        onDelete={(onStep) => onDelete(r, p, onStep)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
