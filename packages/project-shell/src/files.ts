// files.ts — the file-service routes that need no compiled view: opening a project in a
// workspace, its tree and its files. The gate runs on these, and so may an editor outside this
// repository, which is why they stand apart from project.ts: nothing here reaches the song
// compiler's types. See ../docs/fileApi.md.

import type {
  FileContent,
  FileNode,
  ForkedModule,
  ProjectSyncState,
  WorkspaceInfo,
} from "@studio/web-protocol";
import { textHash } from "@studio/web-protocol/text-hash";
import { fget, fsend } from "./fileApi.ts";

/** A write refused because the file changed on disk since its base was read — the caller asks, rather than retrying. */
export const isStaleWrite = (e: unknown): boolean =>
  (e as { status?: number } | null)?.status === 409;

/** The change token the last `/open` answered with; null before one, or from a service too old to say. */
let openedRev: string | null = null;

/** The token a page's first reads can assume, so they are not all asked again on the first poll (docs/fileApi.md). */
export function openedRevision(): string | null {
  return openedRev;
}

export const fileRoutes = {
  /** The BENCH, instead of opening a workspace's project — see docs/fileApi.md. */
  openBench: (project: string | undefined) =>
    fsend<{ workspace: string; project: string }>("POST", "/workspaces/bench", {
      // What the address named, verbatim: the machine builds the bench, so the machine decides.
      project,
    }),

  // --- The open project ---------------------------------------------------------
  workspace: () => fget<WorkspaceInfo>("/workspace"),
  /** Open a project; the machine brings the account's libraries up to date on the way — docs/fileApi.md. */
  open: (path: string) =>
    fsend<WorkspaceInfo>("POST", "/open", { path }).then((info) => {
      openedRev = info.rev ?? null;
      return info;
    }),
  /** Whether `path` is up to date with the relay — `/open` refuses until it is, see docs/launch.md. */
  syncProject: (path: string) =>
    fget<ProjectSyncState>(`/sync/project?path=${encodeURIComponent(path)}`),
  unloadEngine: () => fsend<{ ok: true }>("POST", "/engine/unload", {}),

  // --- The tree and the files in it ---------------------------------------------
  tree: () => fget<FileNode[]>("/tree"),
  read: (path: string) =>
    fget<FileContent>(`/file?path=${encodeURIComponent(path)}`),
  // Saving into the shared `_modules` library forks instead; `forked` says where — docs/fileApi.md.
  // `base` is the text the buffer was edited from: a disk that moved since answers 409 (isStaleWrite) rather than being overwritten.
  write: (path: string, content: string, base?: string) =>
    fsend<{ ok: true; forked?: ForkedModule }>("PUT", "/file", {
      path,
      content,
      ...(base === undefined ? {} : { base: textHash(base) }),
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
};
