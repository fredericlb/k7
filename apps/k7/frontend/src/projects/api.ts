// api.ts — the two services this screen talks to: pl8 holds the SHARES; the account's file
// service, on the server, holds every workspace and the libraries pointer, so what projects
// EXIST — and creating, deleting and opening one — is its answer.
//
// Every call to it names its `AccountFiles` (that service and its ticket): this screen opens no project,
// so `fileApi`'s module-level transport is unconfigured here and would throw. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import {
  type AccountLibrariesReply,
  type AccountWorkspace,
  type AccountWorkspaceList,
  type ColdChainsReply,
  type CommentState,
  ENGINE_TOKEN_HEADER,
  type FileNode,
  type ModelDownloadJob,
  type PublishLibraryBody,
  type RepoProject,
  type ServedProject,
  type ServedProjectReply,
  type ShareComment,
  type ShareSummary,
  type SurfacedProject,
  type SurfacedProjectList,
  USER_HEADER,
  WORKSPACE_HEADER,
  type WorkspaceSyncStatus,
} from "@studio/web-protocol";
import {
  ABOUT_PAGE,
  externalOf,
  LIBRARIES_PAGE,
  localProjectUrl,
  MEDIA_PAGE,
  REHEARSAL_PAGE,
  SETTINGS_PAGE,
  shareUrl,
  TASKS_PAGE,
} from "@studio/web-protocol/projects";
import { serviceUrl } from "@studio/web-protocol/services";

/** Where pl8's routes answer, DERIVED from the services table rather than declared — this origin now (`globalThis.location`, for node tests). */
const PL8_URL = serviceUrl(globalThis.location?.origin ?? "", "pl8");

/** …and on another server, the desktop's configured one; none names this origin. */
export const pl8Url = (server?: string | null): string =>
  server ? serviceUrl(server, "pl8") : PL8_URL;

/** The error the far side carried, or a status code when it carried none — its `status` rides along, a 202 and a 404 being answers. */
async function failed(res: Response, what: string): Promise<Error> {
  const said = (await res.json().catch(() => ({}))) as { error?: string };
  const e: Error & { status?: number } = new Error(
    said.error ?? `${what} ${res.status}`,
  );
  e.status = res.status;
  return e;
}

export async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw await failed(res, what);
  return (await res.json()) as T;
}

// ── pl8: what is left of it here ─────────────────────────────────────────────

// `PL8_URL` and not a relative path: k7 is mounted at the origin ROOT, so a bare `/api/shares` would reach k7's own backend.

/** The one field an address is chosen from — narrower than `AccountWorkspace` on purpose, the surfaces listing carrying it flattened. */
type Addressable = Pick<AccountWorkspace, "name">;

/** Where a project opens: by its workspace's folder name, the one address (../../docs/projects.md). */
export function projectHref(ws: Addressable, p: RepoProject): string {
  return localProjectUrl(window.location.origin, ws.name, p.path, p.app);
}

/**
 * Where the WORKSPACE itself opens — the same choice of address with `.` for the project, which
 * the file service then resolves: the one last open, else the first, else the first-project wizard.
 * This is the only way into a workspace that holds nothing (../../docs/projects.md).
 */
export function workspaceHref(ws: Addressable): string {
  return localProjectUrl(window.location.origin, ws.name, ".", "k7");
}

/** The LIBRARIES page as a ROUTE: with no project in the address the router's basename is the mount, so the home pages switch without a reload. */
export const LIBRARIES_ROUTE = `/${LIBRARIES_PAGE}`;

/** …and the SETTINGS page, the same way. */
export const SETTINGS_ROUTE = `/${SETTINGS_PAGE}`;

/** …and the ABOUT page: k7's version, its licence, its source and the third-party notices. */
export const ABOUT_ROUTE = `/${ABOUT_PAGE}`;

/** …and the desktop app's built-in ENGINE, a page under the settings. */
export const ENGINE_SETTINGS_ROUTE = `/${SETTINGS_PAGE}/engine`;

/** …and the TASKS page, the same way. */
export const TASKS_ROUTE = `/${TASKS_PAGE}`;

/** …and the MEDIA library, a prefix: its sections and open files are routes below it. */
export const MEDIA_ROUTE = `/${MEDIA_PAGE}`;

/** …and the REHEARSAL pages, a prefix like the media library. */
export const REHEARSAL_ROUTE = `/${REHEARSAL_PAGE}`;

/** Where ONE SURFACE of that project opens, on its own — through `projectHref`, so the tablet and the laptop claim the same song. */
export function externalHref(row: SurfacedProject, surface: string): string {
  const ws: Addressable = { name: row.workspace };
  return externalOf(projectHref(ws, { path: row.path, app: row.app }), surface);
}

// ── pl8: the shares ─────────────────────────────────────────────────────────────

const sget = async <T>(path: string, what: string): Promise<T> =>
  json(
    await fetch(`${PL8_URL}/api/shares${path}`, { credentials: "include" }),
    what,
  );

/** The frozen snapshots this person has published, and taking one back — both ends k7's (../../docs/projects.md). */
export const shares = {
  list: () => sget<{ shares: ShareSummary[]; revision: string }>("", "shares"),
  revision: () => sget<{ revision: string }>("/revision", "revision"),

  /** Delete the bytes. The row stays, dated — the list keeps saying what was published. */
  revoke: async (key: string): Promise<void> => {
    const res = await fetch(`${PL8_URL}/api/shares/${key}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) throw await failed(res, "revoke");
  },

  /** What visitors wrote on one snapshot — the author's view, revoked shares included (../../docs/projects.md). */
  comments: (key: string) =>
    sget<{ comments: ShareComment[] }>(`/${key}/comments`, "comments"),

  /** Resolve one, ignore it, or put it back. There is no fourth verb: nothing here deletes. */
  setCommentState: async (
    key: string,
    id: number,
    state: CommentState,
  ): Promise<void> => {
    const res = await fetch(`${PL8_URL}/api/shares/${key}/comments/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) throw await failed(res, "comment");
  },

  /** The link, built from the origin the browser is on: pl8 holds the secret and never the address. */
  url: (token: string): string => shareUrl(window.location.origin, token),
};

// ── the chosen engine's file service: the working copies ────────────────────────

/** The file service this screen acts on — the account's, on the server — and the token that opens the door. */
export interface AccountFiles {
  fileBase: string;
  token: string;
  /** Who is asking — read off `/auth/me` rather than off a configured workspace, this page having none. */
  userEmail: string;
  /** Whether the caller may edit the origin's libraries — the hub's word, which the file service enforces. */
  admin: boolean;
}

/** The file-service calls this page makes, each carrying its file service explicitly: a row touches a different workspace every time. */
export const accountFiles = {
  /**
   * The LIBRARIES the origin holds — an empty list is the ordinary state of a new one.
   *
   * Named service and not through `fileApi`: this screen opens no project, so the module-level
   * transport is unconfigured and `cfg()` would throw "no project opened yet" (../../docs/projects.md).
   */
  libraries: async (m: AccountFiles): Promise<AccountLibrariesReply> =>
    json<AccountLibrariesReply>(
      await fetch(`${m.fileBase}/account/libraries`, {
        headers: filesHeaders(m),
      }),
      "libraries",
    ),

  /** SET the whole list — the far side gives every new library its folder, and keeps the folders of those it lost. */
  setLibraries: async (
    m: AccountFiles,
    libraries: { name: string }[],
  ): Promise<AccountLibrariesReply> =>
    json<AccountLibrariesReply>(
      await fetch(`${m.fileBase}/account/libraries`, {
        method: "PUT",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ libraries }),
      }),
      "libraries",
    ),

  /** Freeze a library's draft as its next version — the hub refuses anyone but an admin (docs/library-versions-plan.md). */
  publishLibrary: async (
    m: AccountFiles,
    name: string,
    body: PublishLibraryBody,
  ): Promise<AccountLibrariesReply> =>
    json<AccountLibrariesReply>(
      await fetch(
        `${m.fileBase}/account/libraries/${encodeURIComponent(name)}/publish`,
        {
          method: "POST",
          headers: { ...filesHeaders(m), "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      "libraries",
    ),

  /** Which COLD chains of the library this machine separates and makes instrumentals with, and the ones it could — machine settings, no project open. */
  coldChains: async (m: AccountFiles): Promise<ColdChainsReply> =>
    json(
      await fetch(`${m.fileBase}/account/cold-chains`, {
        headers: filesHeaders(m),
      }),
      "cold-chains",
    ),

  /** Choose one — `""` clears it. The far side refuses a chain that is not cold, or writes no instrumental when that is asked. */
  setColdChain: async (
    m: AccountFiles,
    which: "stems" | "instrumental",
    ref: string,
  ): Promise<ColdChainsReply> =>
    json(
      await fetch(`${m.fileBase}/account/cold-chains/${which}`, {
        method: "PUT",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ ref }),
      }),
      "cold-chains",
    ),

  /** Download the models a cold chain needs and this machine has not got — one job each; the URLs are the chain's modules', never sent from here. */
  downloadChainModels: async (
    m: AccountFiles,
    ref: string,
  ): Promise<ModelDownloadJob[]> => {
    const { jobs } = await json<{ jobs: ModelDownloadJob[] }>(
      await fetch(`${m.fileBase}/account/cold-chains/download`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ ref }),
      }),
      "cold-chains/download",
    );
    return jobs;
  },

  /** One model download, as it stands. */
  modelDownload: async (
    m: AccountFiles,
    id: string,
  ): Promise<ModelDownloadJob> =>
    json(
      await fetch(`${m.fileBase}/account/models/${encodeURIComponent(id)}`, {
        headers: filesHeaders(m),
      }),
      "models",
    ),

  /** Every workspace of the account, with the projects in it — the file service answers, they being folders on the server. */
  workspaces: async (m: AccountFiles): Promise<AccountWorkspace[]> => {
    const { workspaces } = await json<AccountWorkspaceList>(
      await fetch(`${m.fileBase}/workspaces/projects`, {
        headers: filesHeaders(m),
      }),
      "workspaces",
    );
    return workspaces;
  },

  /** On a machine paired with a remote server, where each workspace lives — synced, here only, or there only. */
  workspaceSync: async (m: AccountFiles): Promise<WorkspaceSyncStatus> =>
    json<WorkspaceSyncStatus>(
      await fetch(`${m.fileBase}/workspaces/sync`, {
        headers: filesHeaders(m),
      }),
      "workspace sync",
    ),

  /** Bring a workspace that is only on a server (the main one without `server`) down here; it stays synced from then on. */
  downloadWorkspace: async (
    m: AccountFiles,
    name: string,
    server?: string,
  ): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces/sync/download`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name, ...(server ? { server } : {}) }),
      }),
      "download",
    );
  },

  /** Start moving a workspace to another server this account is paired with; `workspaceSync` says how it goes. */
  moveWorkspace: async (
    m: AccountFiles,
    name: string,
    to: string,
  ): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces/sync/move`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name, to }),
      }),
      "move",
    );
  },

  /** Start copying a workspace to another server this account is paired with; it stays synced where it was. */
  copyWorkspace: async (
    m: AccountFiles,
    name: string,
    to: string,
  ): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces/sync/copy`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name, to }),
      }),
      "copy",
    );
  },

  /** The same disk, asked what could be put on a SECOND DEVICE — its own route, the home page drawing no surfaces (../../docs/external.md). */
  surfacedProjects: async (m: AccountFiles): Promise<SurfacedProject[]> => {
    const { projects } = await json<SurfacedProjectList>(
      await fetch(`${m.fileBase}/workspaces/surfaces`, {
        headers: filesHeaders(m),
      }),
      "surfaces",
    );
    return projects;
  },

  /** …and which ONE of those the engine is holding for this person: one answer per account, unlike each row's `.studio-active`. */
  servedProject: async (m: AccountFiles): Promise<ServedProject | null> => {
    const { project } = await json<ServedProjectReply>(
      await fetch(`${m.fileBase}/engine/served`, {
        headers: filesHeaders(m),
      }),
      "served",
    );
    return project;
  },

  /** One workspace's whole tree, asked of a workspace this page has not opened — `/tree` needs one. */
  workspaceTree: async (
    m: AccountFiles,
    workspace: string,
  ): Promise<FileNode[]> =>
    json(
      await fetch(`${m.fileBase}/workspace-tree`, {
        headers: { ...filesHeaders(m), [WORKSPACE_HEADER]: workspace },
      }),
      "tree",
    ),

  /** A workspace and NOTHING else: an empty folder on the server. */
  createWorkspace: async (m: AccountFiles, name: string): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
      "workspace",
    );
  },

  /** Scaffold a project in one of the account's workspaces: `name` carries its suffix, and `shape` is the ARCHETYPE (`PROJECT_SHAPES` in @studio/song). */
  createProject: async (
    m: AccountFiles,
    workspace: string,
    name: string,
    shape: ProjectShape,
  ): Promise<{ project: string; missing: string[] }> => {
    const { project, missing } = await json<{
      project: string;
      missing?: string[];
    }>(
      await fetch(`${m.fileBase}/project/create`, {
        method: "POST",
        headers: {
          ...filesHeaders(m),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ shape, name }),
      }),
      "create",
    );
    return { project, missing: missing ?? [] };
  },

  /**
   * A foreign project DROPPED on a workspace row: the bytes go up, the folder name comes from the
   * popin, and nothing is left in the workspace but the project — packages/translator/docs/import.md.
   */
  importProjectFile: async (
    m: AccountFiles,
    workspace: string,
    file: File,
    folder: string,
  ): Promise<{ project: string; log: string[] }> => {
    const q = `file=${encodeURIComponent(file.name)}&name=${encodeURIComponent(folder)}`;
    return json(
      await fetch(`${m.fileBase}/import-upload?${q}`, {
        method: "POST",
        headers: {
          ...filesHeaders(m),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/octet-stream",
        },
        body: await file.arrayBuffer(),
      }),
      "import",
    );
  },

  /** Copy a project into another of the account's workspaces. No workspace HEADER: the body names both. */
  copyProject: async (
    m: AccountFiles,
    from: string,
    path: string,
    to: string,
    name: string,
  ): Promise<string> => {
    const { project } = await json<{ project: string }>(
      await fetch(`${m.fileBase}/workspaces/copy-project`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ from, path, to, name }),
      }),
      "copy",
    );
    return project;
  },

  /** Rename a project's FOLDER in place; the suffix stays. */
  renameProject: async (
    m: AccountFiles,
    workspace: string,
    path: string,
    name: string,
  ): Promise<string> => {
    const { path: renamed } = await json<{ path: string }>(
      await fetch(`${m.fileBase}/project/rename`, {
        method: "POST",
        headers: {
          ...filesHeaders(m),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ path, name }),
      }),
      "rename",
    );
    return renamed;
  },

  /** Delete a workspace — the folder and everything under it, for good. */
  removeWorkspace: async (
    m: AccountFiles,
    workspace: string,
  ): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces/remove`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name: workspace }),
      }),
      "delete",
    );
  },

  /** Put the bundled demos in Examples back as they shipped; the user's own projects there stay. */
  resetExamples: async (m: AccountFiles): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces/examples/reset`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: "{}",
      }),
      "reset",
    );
  },

  /** Unload the project and move its folder to the workspace's recycle bin. */
  deleteProject: async (
    m: AccountFiles,
    workspace: string,
    path: string,
  ): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/project/delete`, {
        method: "POST",
        headers: {
          ...filesHeaders(m),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ path }),
      }),
      "delete",
    );
  },
};

export const filesHeaders = (m: AccountFiles): Record<string, string> => ({
  [USER_HEADER]: m.userEmail,
  [ENGINE_TOKEN_HEADER]: m.token,
});
