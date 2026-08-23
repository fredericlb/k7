// RepoList.tsx — the machine's workspaces, each with its projects indented: add one by SSH URI
// (which registers it with pl8 AND clones it), or open a project straight into a new tab.
// Presentational — the section holds the async and this file draws. See ../../docs/projects.md.

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

/** The folder's name without its suffix, with the path that places it in the workspace beside it. */
const nameOf = (p: RepoProject): string =>
  projectLabel(p.path.split("/").pop() ?? p.path);

/** The folder holding the project, or null when it sits at the workspace root. */
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
  /** Where the running clone is, in git's own words, or null — adding a repository CLONES it, or it would be registered and invisible here. */
  adding: string | null;
  hasMachine: boolean;
  onAdd: (uri: string) => void;
  onOpen: (ws: MachineWorkspace) => void;
  /** Why create and delete are impossible, or "" — both go through the machine, which is also what READS this list (../../docs/projects.md). */
  blocked: string;
  onCreate: (
    ws: MachineWorkspace,
    folder: string,
    onStep: (s: string) => void,
    /** `arrangement`, `mix` or `video`. See NewProject. */
    shape: ProjectShape,
  ) => Promise<void>;
  onDelete: (
    ws: MachineWorkspace,
    project: RepoProject,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** The pl8-registered repository behind this workspace, or null — what makes the portable address resolvable, and what can be removed. */
  repoFor: (ws: MachineWorkspace) => RepoSummary | null;
  /** Take the repository out of the register — the folder stays: removing a name from a list deletes nobody's files. */
  onForget: (repo: RepoSummary) => void;
  /** A project's address in ITS app — an address and not an action: the row is a link, opening in a new tab. */
  projectHref: (ws: MachineWorkspace, project: RepoProject) => string;
  /** Every share of the account, cut per row here (`sharesOf`) — pl8 returns the whole list, which saves a request per project. */
  shares: ShareSummary[];
  /** After a revocation, so the page re-reads without waiting for the poll. */
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

      {/* Git's own words during the clone, not ours: a silent thirty-second wait reads as a frozen screen. */}
      {adding !== null && (
        <span className="text-xs text-muted-foreground">{adding}</span>
      )}

      {error && (
        <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}

      {!hasMachine ? (
        // The price of the move, said where it is paid: with no machine there is no list, and an empty one would read as a new account.
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
                  {/* A clone and a hand-made folder are not the same thing, and the icon says so before the URI below is read. */}
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
                  {/* Inside the workspace's block, beside its contents: creating a project acts ON it, not on the list. */}
                  <NewProject
                    blocked={blocked}
                    onCreate={(folder, onStep, shape) =>
                      onCreate(w, folder, onStep, shape)
                    }
                  />
                  {/* Only when there is a registered repository to remove; the label says the list is what is left, not the disk. */}
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

              {/* The projects, indented under their workspace: a click goes straight into the app that opens one, in a new tab. */}
              {w.projects.length > 0 && (
                <ul className="mt-2 ml-2 flex flex-col border-l border-border pl-3">
                  {w.projects.map((p) => (
                    // The row holds the link AND the buttons: the link stretches, and each button's `preventDefault` stops it opening.
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
                      {/* Before Supprimer: reading what you published comes ahead of the destructive act, and needs a machine (../../docs/projects.md). */}
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

              {/* A workspace whose portable address does not resolve opens through `@local`, which names a folder on THIS machine alone. */}
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
