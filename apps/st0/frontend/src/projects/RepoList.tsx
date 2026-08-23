// RepoList.tsx — les espaces de travail de la machine, chacun avec ses projets en retrait : en
// ajouter un par URI SSH (ce qui l'inscrit chez pl8 ET le clone), ou ouvrir un projet
// directement, dans un nouvel onglet. Présentationnel : la section détient l'asynchrone et
// ce fichier dessine. Voir ../../docs/projects.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  MachineWorkspace,
  RepoProject,
  RepoSummary,
  ShareSummary,
} from "@studio/web-protocol";
import { projectLabel } from "@studio/web-protocol/projects";
import {
  CornerDownRight,
  FolderGit2,
  HardDrive,
  Loader2,
  Plus,
  ServerOff,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { DeleteProject } from "./DeleteProject";
import { NewProject } from "./NewProject";
import { ProjectShares } from "./ProjectShares";
import { sharesOf } from "./sharesForProject";

/** Le nom du dossier, sans son suffixe : `chansons/hiver.st0` s'affiche « hiver », et le
 *  chemin qui la situe dans l'espace de travail est à côté. */
const nameOf = (p: RepoProject): string =>
  projectLabel(p.path.split("/").pop() ?? p.path);

/** Le dossier qui contient le projet, ou null quand il est à la racine de l'espace. */
const parentOf = (p: RepoProject): string | null => {
  const cut = p.path.lastIndexOf("/");
  return cut > 0 ? p.path.slice(0, cut) : null;
};

export function RepoList({
  workspaces,
  busy,
  error,
  adding,
  hasMachine,
  onAdd,
  onOpen,
  blocked,
  onCreate,
  onDelete,
  repoFor,
  onForget,
  projectHref,
  shares,
  onChanged,
}: {
  workspaces: MachineWorkspace[];
  busy: boolean;
  error: string | null;
  /** Où en est le clone en cours, dans les mots de git, ou null. Ajouter un dépôt le CLONE
   *  maintenant : sans ça il serait inscrit chez pl8 et invisible ici, cette liste ne montrant
   *  que ce que la machine tient. */
  adding: string | null;
  hasMachine: boolean;
  onAdd: (uri: string) => void;
  onOpen: (ws: MachineWorkspace) => void;
  /** Pourquoi créer et supprimer sont impossibles, ou "". Les deux passent par la machine, qui
   *  est aussi ce qui LIT cette liste — voir ../../docs/projects.md. */
  blocked: string;
  onCreate: (
    ws: MachineWorkspace,
    folder: string,
    onStep: (s: string) => void,
    /** `arrangement`, `mix` ou `video`. Voir NewProject. */
    shape: ProjectShape,
  ) => Promise<void>;
  onDelete: (
    ws: MachineWorkspace,
    project: RepoProject,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** Le dépôt inscrit chez pl8 derrière cet espace de travail, ou null. C'est lui qui rend
   *  l'adresse portable `/<dépôt>/<projet>` résoluble — et lui qu'on peut retirer. */
  repoFor: (ws: MachineWorkspace) => RepoSummary | null;
  /** Retirer le dépôt du registre. Le dossier reste : retirer un nom d'une liste ne supprime
   *  les fichiers de personne. */
  onForget: (repo: RepoSummary) => void;
  /** L'adresse d'un projet dans SON application. Une adresse et non une action : la rangée est
   *  un lien, qui s'ouvre dans un nouvel onglet. */
  projectHref: (ws: MachineWorkspace, project: RepoProject) => string;
  /** Tous les partages du compte. Chaque rangée prend les siens (`sharesOf`) — pl8 rend la liste
   *  entière en un appel, et découper ici évite une requête par projet. */
  shares: ShareSummary[];
  /** Après une révocation, pour que la page relise sans attendre le poll. */
  onChanged: () => void;
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
          className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          placeholder="git@hôte:utilisateur/depot.git — URI SSH uniquement"
          value={uri}
          disabled={!hasMachine || adding !== null}
          title={blocked || undefined}
          onChange={(e) => setUri(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={add}
          title={blocked || undefined}
          disabled={!uri.trim() || !hasMachine || adding !== null}
        >
          {adding !== null ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}{" "}
          Ajouter
        </Button>
      </div>

      {/* Les mots de git pendant le clone, pas les nôtres : « Receiving objects », « Resolving
          deltas ». Une attente de trente secondes qui ne dit rien ressemble à un écran figé. */}
      {adding !== null && (
        <span className="text-xs text-muted-foreground">{adding}</span>
      )}

      {error && (
        <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}

      {!hasMachine ? (
        // Le prix du déménagement, dit là où il se paie. Un projet est un dossier sur la machine
        // du moteur : sans elle il n'y a pas de liste à montrer, et prétendre le contraire — une
        // liste vide, une invitation à ajouter un dépôt — se lirait comme un compte neuf.
        <div className="flex flex-col items-center gap-2 rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          <ServerOff className="h-5 w-5 text-amber-500" />
          <span>
            Aucune machine moteur joignable. Vos projets sont des dossiers sur
            cette machine, c'est donc elle qui dit lesquels existent.
          </span>
          <span className="text-xs">
            Les bibliothèques, les partages et la clé de déploiement se règlent
            sans elle, plus bas.
          </span>
        </div>
      ) : workspaces.length === 0 ? (
        <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </span>
          ) : (
            <>
              Rien sur cette machine. Collez une URI SSH ci-dessus — et pensez à
              ajouter la clé de déploiement chez votre hébergeur git d'abord.
            </>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {workspaces.map((w) => (
            <li
              key={w.name}
              className="flex flex-col rounded-md border border-border p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => onOpen(w)}
                >
                  {/* Un clone et un dossier fait à la main ne sont pas la même chose, et
                      l'icône est ce qui le dit avant qu'on lise l'URI dessous. */}
                  {w.origin ? (
                    <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{w.name}</span>
                      <Badge variant={w.projects.length ? "tag" : "default"}>
                        {w.projects.length} projet
                        {w.projects.length === 1 ? "" : "s"}
                      </Badge>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {w.origin ?? "sur cette machine seulement"}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Dans le bloc de l'espace, à côté de son contenu : créer un projet est une
                      opération SUR celui-ci, pas sur la liste. */}
                  <NewProject
                    blocked={blocked}
                    onCreate={(folder, onStep, shape) =>
                      onCreate(w, folder, onStep, shape)
                    }
                  />
                  {/* Seulement quand il y a un dépôt inscrit à retirer. Le libellé dit ce qui se
                      passe et ce qui ne se passe pas : c'est la liste qu'on quitte, pas le
                      disque. */}
                  {repoFor(w) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Retirer ce dépôt de vos dépôts — le dossier reste sur la machine"
                      onClick={() => {
                        const r = repoFor(w);
                        if (r) onForget(r);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Les projets, en retrait sous leur espace de travail : c'est ce qu'on vient
                  chercher ici, et un clic va droit dans l'application qui l'ouvre — dans un
                  nouvel onglet, cette liste restant ce à quoi on revient. Le nom de l'espace
                  reste cliquable pour l'arborescence, qui montre tout le reste. */}
              {w.projects.length > 0 && (
                <ul className="mt-2 ml-2 flex flex-col border-l border-border pl-3">
                  {w.projects.map((p) => (
                    // La rangée tient le lien ET les boutons : le lien s'étire, les boutons
                    // restent au bout, et le `preventDefault` de chacun l'empêche d'ouvrir.
                    <li key={p.path} className="flex items-center gap-1">
                      <a
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent/50"
                        title={`Ouvrir ${p.path} dans ${p.app}`}
                        href={projectHref(w, p)}
                        target="_blank"
                        rel="noopener"
                      >
                        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {p.path === "." ? projectLabel(w.name) : nameOf(p)}
                        </span>
                        <Badge variant="tag">{p.app}</Badge>
                        {parentOf(p) && (
                          <span className="truncate text-xs text-muted-foreground">
                            {parentOf(p)}
                          </span>
                        )}
                      </a>
                      {/* Avant « Supprimer » : voir ce qu'on a publié est une lecture, et
                          elle passe devant l'action destructrice. Sans machine, cette liste
                          n'existe pas — voir ../../docs/projects.md. */}
                      <ProjectShares
                        label={p.path === "." ? w.name : nameOf(p)}
                        shares={sharesOf(shares, w.name, p.path)}
                        onChanged={onChanged}
                      />
                      <DeleteProject
                        path={p.path}
                        label={p.path === "." ? w.name : nameOf(p)}
                        blocked={blocked}
                        onDelete={(onStep) => onDelete(w, p, onStep)}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {/* Un espace dont l'adresse portable ne se résout pas s'ouvre par `@local`, qui
                  nomme un dossier de CETTE machine et rien ailleurs. Dit ici plutôt que
                  découvert en collant le lien à quelqu'un. */}
              {w.origin && !w.uniqueName && (
                <span className="mt-2 flex items-start gap-1 text-xs text-amber-500">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    deux copies répondent au nom « {w.repoName} » — ces projets
                    s'ouvrent par une adresse propre à cette machine
                  </span>
                </span>
              )}
              {w.origin && w.uniqueName && !repoFor(w) && (
                <span className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    ce dépôt n'est pas dans vos dépôts — ces projets s'ouvrent
                    par une adresse propre à cette machine. Collez son URI
                    ci-dessus pour l'inscrire.
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
