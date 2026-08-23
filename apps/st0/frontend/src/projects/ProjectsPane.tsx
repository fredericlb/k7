// ProjectsPane.tsx — the home page's body: the machine's workspaces, or the tree of whichever one
// is unfolded. It holds the async for the two presentational views beside it. Which one is open
// comes from the address (Home.tsx), not from local state. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  FileNode,
  MachineWorkspace,
  RepoProject,
  RepoSummary,
  ShareSummary,
} from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { projects as api, engineMachine, projectHref } from "./api";
import { LibrariesCard } from "./LibrariesCard";
import {
  createProjectOnMachine,
  deleteProjectOnMachine,
  ensureWorkspace,
  type Machine,
} from "./machine";
import { RepoList } from "./RepoList";
import { RepoTree } from "./RepoTree";
import { SshKeyCard } from "./SshKeyCard";

export function ProjectsPane({
  workspaces,
  repos,
  shares,
  busy,
  openWs,
  machine,
  onOpen,
  onChanged,
}: {
  /** What the machine holds, projects included — the only source, since a project is a folder
   *  there and pl8 keeps nothing but the register of repositories. */
  workspaces: MachineWorkspace[];
  /** pl8's register — not a list to draw, but the other half of "does this address resolve":
   *  `/<repo>/<project>` goes through `by-name`, and a copy the register ignores opens `@local`. */
  repos: RepoSummary[];
  /** Frozen snapshots published by `project share link`. The account's WHOLE list, not one call
   *  per row: pl8 cannot filter, and the rows cut it up themselves with `sharesOf`. */
  shares: ShareSummary[];
  busy: boolean;
  /** The unfolded workspace's name, taken from the address, or null for the list. */
  openWs: string | null;
  /**
   * The chosen machine, or null when none answers.
   *
   * It no longer only writes: it is what READS the list. Projects are its folders, and the bare
   * mirror pl8 kept to answer in its place was a second copy of them — one `git fetch` behind,
   * and blind to a committed project whose push had not gone through.
   */
  machine: Machine | null;
  onOpen: (name: string | null) => void;
  /** Call after any write, so the page reloads without waiting for the poll. */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const ws = workspaces.find((w) => w.name === openWs) ?? null;
  // The register by short name. A Map rather than a `find` per row, which every project re-runs.
  const registry = useMemo(
    () => new Map(repos.map((r) => [r.name, r])),
    [repos],
  );
  const registered = useMemo(() => new Set(registry.keys()), [registry]);
  /** The registered repository behind a workspace, or null — which is what makes removal possible. */
  const repoFor = useCallback(
    (w: MachineWorkspace) => (w.repoName && registry.get(w.repoName)) || null,
    [registry],
  );

  /** What stops a write, in one sentence, or "". Said on the button rather than found on click. */
  const blocked = machine
    ? ""
    : "aucune machine moteur joignable — un projet est un dossier sur la machine, et c'est elle qui les fait";

  /** The machine, or a refusal that reads. Reaching here at all means it vanished between the
   *  dialog opening and the click, since the buttons are already grey without one. */
  const chosen = useCallback((): Machine => {
    if (!machine) throw new Error(blocked);
    return machine;
  }, [machine, blocked]);

  /**
   * Adding a repository means registering it with pl8 AND THEN cloning it here.
   *
   * Both, in that order. pl8 holds the register — a repository belongs to a person rather than a
   * machine, which is what lets `/<repo>/<project>` resolve from any of them. The clone is what
   * makes it APPEAR here, since this page lists only what the machine holds.
   */
  const add = useCallback(
    async (uri: string) => {
      setError(null);
      try {
        await api.add(uri);
        onChanged();
        await ensureWorkspace(chosen(), uri, (s) => setAdding(s));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setAdding(null);
        onChanged();
      }
    },
    [chosen, onChanged],
  );

  const create = useCallback(
    async (
      w: MachineWorkspace,
      folder: string,
      onStep: (s: string) => void,
      shape: ProjectShape,
    ) => {
      const { gripe } = await createProjectOnMachine(
        chosen(),
        w.name,
        folder,
        onStep,
        shape,
      );
      onChanged();
      // The project EXISTS on the machine; only the push failed. Throwing would invite a retry.
      if (gripe) setError(`${folder} créé, mais : ${gripe}`);
    },
    [chosen, onChanged],
  );

  /**
   * Remove a repository from pl8's register — and nothing else.
   *
   * The row does NOT disappear: it shows a folder this machine holds, and taking something out of
   * a list must not delete somebody's files. What changes is the address — `/<repo>/<project>`
   * stops resolving, so this workspace's projects fall back to `@local`.
   */
  const forgetRepo = useCallback(
    (r: RepoSummary) => {
      setError(null);
      void api
        .remove(r.id)
        .then(onChanged)
        .catch((e: Error) => setError(e.message));
    },
    [onChanged],
  );

  const removeProject = useCallback(
    async (
      w: MachineWorkspace,
      p: RepoProject,
      onStep: (s: string) => void,
    ) => {
      const { gripe } = await deleteProjectOnMachine(
        chosen(),
        w.name,
        p.path,
        onStep,
      );
      onChanged();
      if (gripe) setError(`${p.path} supprimé, mais : ${gripe}`);
    },
    [chosen, onChanged],
  );

  /** The unfolded workspace's tree, read off the machine. One request, no retry: it is a `readdir`
   *  on a disk that is there. The loop that used to be here waited on a mirror that is gone. */
  useEffect(() => {
    if (!openWs || !machine) {
      setNodes(null);
      return;
    }
    let stop = false;
    setNodes(null);
    void engineMachine
      .workspaceTree(machine, openWs)
      .then((n) => {
        if (!stop) setNodes(n);
      })
      .catch((e: Error) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, [openWs, machine]);

  // The libraries repository comes FIRST: nothing else here works until a new account has one.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <LibrariesCard />
      {ws ? (
        <RepoTree
          workspace={ws}
          nodes={nodes}
          onBack={() => onOpen(null)}
          projectHref={(path, app) =>
            projectHref(ws, { path, app }, registered)
          }
        />
      ) : (
        <>
          <RepoList
            workspaces={workspaces}
            busy={busy}
            error={error}
            adding={adding}
            hasMachine={machine !== null}
            onAdd={(uri) => void add(uri)}
            onOpen={(w) => onOpen(w.name)}
            blocked={blocked}
            onCreate={create}
            onDelete={removeProject}
            repoFor={repoFor}
            onForget={forgetRepo}
            // Same departure as from the tree: the app's address, not a view local to here.
            projectHref={(w, p) => projectHref(w, p, registered)}
            // Shares COME OUT of a project, so they belong to its row rather than to a card below.
            shares={shares}
            onChanged={onChanged}
          />
          {/* La clé de déploiement reste tout en bas : réglée une fois, sur le compte. */}
          <div className="mt-auto">
            <SshKeyCard />
          </div>
        </>
      )}
    </div>
  );
}
