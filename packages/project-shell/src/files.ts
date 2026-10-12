// files.ts — the file-service routes that need no compiled view: resolving a repository to a
// workspace, opening a project in it, its tree and files, and its git. The gate runs on these,
// and so does z0's editor, which is why they stand apart from project.ts: nothing here reaches
// the song compiler's types. See ../docs/fileApi.md.

import type {
  Alternatives,
  CloneJob,
  FileContent,
  FileNode,
  ForkedModule,
  GitCommitResult,
  GitPullResult,
  GitStatus,
  WorkspaceForRepo,
  WorkspaceInfo,
} from "@studio/web-protocol";
import { fget, fsend } from "./fileApi.ts";

export const fileRoutes = {
  // --- pl8 knows a REPOSITORY, this machine knows folders (file-service/docs/cloneJobs.md) ---
  workspaceByRepo: (uri: string) =>
    fget<WorkspaceForRepo>(
      `/workspaces/by-repo?uri=${encodeURIComponent(uri)}`,
    ),
  startClone: (uri: string) =>
    fsend<CloneJob>("POST", "/workspaces/clone", { uri }),
  cloneStatus: (id: string) => fget<CloneJob>(`/workspaces/clone/${id}`),
  /** The BENCH, INSTEAD of the three calls above — see docs/fileApi.md. */
  openBench: (project: string | undefined) =>
    fsend<{ workspace: string; project: string }>("POST", "/workspaces/bench", {
      // What the address named, verbatim: the machine builds the bench, so the machine decides.
      project,
    }),

  // --- The open project ---------------------------------------------------------
  workspace: () => fget<WorkspaceInfo>("/workspace"),
  /** Open the project, and say which library repository to mount — see docs/fileApi.md. */
  /** Open a project; the machine brings the account's libraries up to date on the way — docs/fileApi.md. */
  open: (path: string) => fsend<WorkspaceInfo>("POST", "/open", { path }),
  unloadEngine: () => fsend<{ ok: true }>("POST", "/engine/unload", {}),

  // --- The tree and the files in it ---------------------------------------------
  tree: () => fget<FileNode[]>("/tree"),
  read: (path: string) =>
    fget<FileContent>(`/file?path=${encodeURIComponent(path)}`),
  // Saving into the shared `_modules` library forks instead; `forked` says where — docs/fileApi.md.
  write: (path: string, content: string) =>
    fsend<{ ok: true; forked?: ForkedModule }>("PUT", "/file", {
      path,
      content,
    }),
  fmt: (path: string) => fsend<FileContent>("POST", "/fmt", { path }),
  createFolder: (dir: string, name: string) =>
    fsend<{ path: string }>("POST", "/folder", { dir, name }),
  // A library module's refs follow a rename, and `repointed` lists the files that changed — song docs/moduleMove.md.
  renameFile: (path: string, name: string) =>
    fsend<{ path: string; repointed?: string[] }>("POST", "/rename", {
      path,
      name,
    }),
  moveFile: (path: string, toDir: string) =>
    fsend<{ path: string }>("POST", "/move", { path, toDir }),
  // Recycled, not erased — reversible, but no longer listed or startable.
  deleteFile: (path: string) =>
    fsend<{ recycled: string }>("POST", "/entry/delete", { path }),

  // --- The repository's git. A workspace IS one clone, so none of this needs a project. ---
  gitStatus: () => fget<GitStatus>("/git/status"), // fetches, so callers poll it rarely
  alternatives: () => fget<Alternatives>("/git/alternatives"),
  gitCommit: (message: string) =>
    fsend<GitCommitResult>("POST", "/git/commit", { message }),
  gitPull: () => fsend<GitPullResult>("POST", "/git/pull", {}),
};
