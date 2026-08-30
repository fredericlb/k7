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
import { projectLabel, settingsUrl } from "@studio/web-protocol/projects";
import {
  CornerDownRight,
  FolderGit2,
  FolderPlus,
  HardDrive,
  Loader2,
  ServerOff,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { DeleteProject } from "./DeleteProject";
import { ImportWorkspace } from "./ImportWorkspace";
import type { Machine } from "./machine";
import { NewProject } from "./NewProject";
import { NewWorkspace } from "./NewWorkspace";
import { ProjectShares } from "./ProjectShares";
import { PublishWorkspace } from "./PublishWorkspace";
import { sharesOf } from "./sharesForProject";

// The one link out of this screen, since the key moved: computed rather than spelled, so a service that moves takes it with it.
const SETTINGS_URL = settingsUrl(globalThis.location?.origin ?? "");

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
  onImport,
  onCreateWorkspace,
  onPublish,
  onOpen,
  blocked,
  onCreate,
  onDelete,
  repoFor,
  onForget,
  projectHref,
  workspaceHref,
  shares,
  onChanged,
  machine,
  lanUrls,
}: {
  workspaces: MachineWorkspace[];
  busy: boolean;
  error: string | null;
  /** Where the running clone is, in git's own words, or null — adding a repository CLONES it, or it would be registered and invisible here. */
  adding: string | null;
  hasMachine: boolean;
  /** Register a repository and clone it — the Import button's act. */
  onImport: (uri: string) => Promise<void>;
  /** A workspace of one's own, git-initialised here with no repository behind it and nothing in it. */
  onCreateWorkspace: (
    workspace: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** Its first repository: the remote, the push, and the register — offered on a local workspace only. */
  onPublish: (
    ws: MachineWorkspace,
    uri: string,
    onStep: (s: string) => void,
  ) => Promise<{ registered: boolean }>;
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
  /** …and where the WORKSPACE opens, for a row that has no project to link to yet. */
  workspaceHref: (ws: MachineWorkspace) => string;
  /** The chosen machine, which is what knows a project's surfaces — null when none answers. */
  machine: Machine | null;
  /** Where a second device reaches this app (apps/studio-desktop/docs/externals.md). */
  lanUrls: string[];
  /** Every share of the account, cut per row here (`sharesOf`) — pl8 returns the whole list, which saves a request per project. */
  shares: ShareSummary[];
  /** After a revocation, so the page re-reads without waiting for the poll. */
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-6">
      {/* The two ways one appears, side by side: made here, or brought back from a repository. */}
      <div className="flex items-center gap-2">
        <NewWorkspace blocked={blocked} onCreate={onCreateWorkspace} />
        <ImportWorkspace blocked={blocked} step={adding} onImport={onImport} />
      </div>

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
            Les bibliothèques et les partages se règlent sans elle, plus bas ;
            la clé de déploiement est dans les{" "}
            <a href={SETTINGS_URL} className="underline">
              réglages
            </a>
            .
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
              Rien sur cette machine. <strong>Nouveau</strong> en crée un ici,
              sans dépôt et sans rien à régler ; <strong>Importer</strong> en
              rapatrie un qui existe — et pour celui-là, pensez à ajouter la{" "}
              <a href={SETTINGS_URL} className="underline">
                clé de déploiement
              </a>{" "}
              chez votre hébergeur git d'abord.
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
                  {/* A workspace with no repository has one gesture the others do not: getting one. */}
                  {!w.origin && (
                    <PublishWorkspace
                      workspace={w.name}
                      blocked={blocked}
                      onPublish={(uri, onStep) => onPublish(w, uri, onStep)}
                    />
                  )}
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

              {/* Nothing in it yet. The link opens the WORKSPACE, and the editor asks for the
                  first project there — see FirstProject.tsx. It is the only way in: with no
                  project there is no project row to click. */}
              {w.projects.length === 0 && (
                <a
                  className="mt-2 ml-2 flex w-fit items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/50"
                  href={workspaceHref(w)}
                  title={`Ouvrir ${w.name} et y créer un projet`}
                >
                  <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>Créer le premier projet</span>
                </a>
              )}

              {/* The projects, indented under their workspace: a click goes straight into the app
                  that opens one, in THIS tab — the header's name is the way back. */}
              {w.projects.length > 0 && (
                <ul className="mt-2 ml-2 flex flex-col border-l border-border pl-3">
                  {w.projects.map((p) => (
                    // The row holds the link AND the buttons: the link stretches, and each button's `preventDefault` stops it opening.
                    <li key={p.path} className="flex items-center gap-1">
                      <a
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent/50"
                        title={`Ouvrir ${p.path} dans ${p.app}`}
                        href={projectHref(w, p)}
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
                        // …and the same popin's other tab: the QR codes that open this project
                        // on a second device (../../docs/projects.md).
                        projectUrl={projectHref(w, p)}
                        workspace={w.name}
                        path={p.path}
                        machine={machine}
                        lanUrls={lanUrls}
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
