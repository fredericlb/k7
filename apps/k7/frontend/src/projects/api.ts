// api.ts — the two services this screen talks to: pl8 holds the SHARES; the account's file
// service, on the server, holds every workspace and the libraries pointer, so what projects
// EXIST — and creating, deleting and opening one — is its answer.
//
// Every call to it names its `AccountFiles` (that service and its ticket): this screen opens no project,
// so `fileApi`'s module-level transport is unconfigured here and would throw. See ../../docs/projects.md.

import { failed, readJson } from "@studio/http-client/call";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import {
  type AccountLibrariesReply,
  type AccountWorkspace,
  type AccountWorkspaceList,
  type ColdChainsReply,
  type CommentState,
  ENGINE_TOKEN_HEADER,
  type FileNode,
  type FrozenChain,
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

/** …and the FROZEN CHAINS page under it, so no workspace name is taken (../../docs/frozenChains.md). */
export const FROZEN_CHAINS_ROUTE = `/${LIBRARIES_PAGE}/chains`;

/** …and the SETTINGS page, the same way. */
export const SETTINGS_ROUTE = `/${SETTINGS_PAGE}`;

/** …and the ABOUT page: k7's version, its licence, its source and the third-party notices. */
export const ABOUT_ROUTE = `/${ABOUT_PAGE}`;

/** …and the ENGINE page beside the settings: this machine's on the tray, the engines this account may use everywhere. */
export const ENGINE_SETTINGS_ROUTE = `/${SETTINGS_PAGE}/engine`;

/** …and the SERVER page, its admins' own, under the same prefix so no workspace name is taken. */
export const SERVER_SETTINGS_ROUTE = `/${SETTINGS_PAGE}/server`;

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
  readJson(
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

/** One call to the account's file service: its headers, the workspace a row names, and a body when there is one. */
async function call<T>(
  m: AccountFiles,
  path: string,
  what: string,
  opts: {
    method?: string;
    workspace?: string;
    json?: unknown;
    body?: BodyInit;
    type?: string;
  } = {},
): Promise<T> {
  const headers = filesHeaders(m);
  if (opts.workspace) headers[WORKSPACE_HEADER] = opts.workspace;
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.type) headers["content-type"] = opts.type;
  return readJson<T>(
    await fetch(`${m.fileBase}${path}`, { method: opts.method, headers, body }),
    what,
  );
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
    call<AccountLibrariesReply>(m, `/account/libraries`, "libraries"),

  /** SET the whole list — the far side gives every new library its folder, and keeps the folders of those it lost. */
  setLibraries: async (
    m: AccountFiles,
    libraries: { name: string }[],
  ): Promise<AccountLibrariesReply> =>
    call<AccountLibrariesReply>(m, `/account/libraries`, "libraries", {
      method: "PUT",
      json: { libraries },
    }),

  /** Freeze a library's draft as its next version — the hub refuses anyone but an admin (docs/library-versions-plan.md). */
  publishLibrary: async (
    m: AccountFiles,
    name: string,
    body: PublishLibraryBody,
  ): Promise<AccountLibrariesReply> =>
    call<AccountLibrariesReply>(
      m,
      `/account/libraries/${encodeURIComponent(name)}/publish`,
      "libraries",
      { method: "POST", json: body },
    ),

  /** The Frozen chains page's list: the account's own chains, then the libraries' cold ones (../../docs/frozenChains.md). */
  frozenChains: async (
    m: AccountFiles,
  ): Promise<{ chains: FrozenChain[]; rehearsalChain: string | null }> =>
    call(m, `/account/frozen-chains`, "frozen-chains"),

  /** Choose the chain rehearsals are recorded through; `""` clears it, and they record from the microphone. */
  setRehearsalChain: async (
    m: AccountFiles,
    ref: string,
  ): Promise<string | null> =>
    (
      await call<{ ref: string | null }>(
        m,
        `/account/rehearsal-chain`,
        "rehearsal-chain",
        { method: "PUT", json: { ref } },
      )
    ).ref,

  /** Copy any library chain whole into the account's, as `name`; the reply is the copy as it reads. */
  copyFrozenChain: async (
    m: AccountFiles,
    from: string,
    name: string,
  ): Promise<FrozenChain> =>
    call(m, `/account/frozen-chains/${encodeURIComponent(name)}/copy`, "copy", {
      method: "POST",
      json: { from },
    }),

  deleteFrozenChain: async (m: AccountFiles, name: string): Promise<void> => {
    await call(
      m,
      `/account/frozen-chains/${encodeURIComponent(name)}`,
      "delete",
      {
        method: "DELETE",
      },
    );
  },

  /** Which COLD chains of the library this machine separates and makes instrumentals with, and the ones it could — machine settings, no project open. */
  coldChains: async (m: AccountFiles): Promise<ColdChainsReply> =>
    call(m, `/account/cold-chains`, "cold-chains"),

  /** Choose one — `""` clears it. The far side refuses a chain that is not cold, or writes no instrumental when that is asked. */
  setColdChain: async (
    m: AccountFiles,
    which: "stems" | "instrumental",
    ref: string,
  ): Promise<ColdChainsReply> =>
    call(m, `/account/cold-chains/${which}`, "cold-chains", {
      method: "PUT",
      json: { ref },
    }),

  /** Download the models a cold chain needs and this machine has not got — one job each; the URLs are the chain's modules', never sent from here. */
  downloadChainModels: async (
    m: AccountFiles,
    ref: string,
  ): Promise<ModelDownloadJob[]> => {
    const { jobs } = await call<{ jobs: ModelDownloadJob[] }>(
      m,
      `/account/cold-chains/download`,
      "cold-chains/download",
      { method: "POST", json: { ref } },
    );
    return jobs;
  },

  /** One model download, as it stands. */
  modelDownload: async (
    m: AccountFiles,
    id: string,
  ): Promise<ModelDownloadJob> =>
    call(m, `/account/models/${encodeURIComponent(id)}`, "models"),

  /** Every workspace of the account, with the projects in it — the file service answers, they being folders on the server. */
  workspaces: async (m: AccountFiles): Promise<AccountWorkspace[]> => {
    const { workspaces } = await call<AccountWorkspaceList>(
      m,
      `/workspaces/projects`,
      "workspaces",
    );
    return workspaces;
  },

  /** On a machine with an active server, where each workspace lives — synced, here only, or there only. */
  workspaceSync: async (m: AccountFiles): Promise<WorkspaceSyncStatus> =>
    call<WorkspaceSyncStatus>(m, `/workspaces/sync`, "workspace sync"),

  /** Bring a workspace that is only on the active server down here; it stays synced from then on. */
  downloadWorkspace: async (m: AccountFiles, name: string): Promise<void> => {
    await call(m, `/workspaces/sync/download`, "download", {
      method: "POST",
      json: { name },
    });
  },

  /** The same disk, asked what could be put on a SECOND DEVICE — its own route, the home page drawing no surfaces (../../docs/external.md). */
  surfacedProjects: async (m: AccountFiles): Promise<SurfacedProject[]> => {
    const { projects } = await call<SurfacedProjectList>(
      m,
      `/workspaces/surfaces`,
      "surfaces",
    );
    return projects;
  },

  /** …and which ONE of those the engine is holding for this person: one answer per account, unlike each row's `.studio-active`. */
  servedProject: async (m: AccountFiles): Promise<ServedProject | null> => {
    const { project } = await call<ServedProjectReply>(
      m,
      `/engine/served`,
      "served",
    );
    return project;
  },

  /** One workspace's whole tree, asked of a workspace this page has not opened — `/tree` needs one. */
  workspaceTree: async (
    m: AccountFiles,
    workspace: string,
  ): Promise<FileNode[]> => call(m, `/workspace-tree`, "tree", { workspace }),

  /** A workspace and NOTHING else: an empty folder, synced with the active server when there is one. */
  createWorkspace: async (m: AccountFiles, name: string): Promise<void> => {
    await call(m, `/workspaces`, "workspace", {
      method: "POST",
      json: { name },
    });
  },

  /** Scaffold a project in one of the account's workspaces: `name` carries its suffix, and `shape` is the ARCHETYPE (`PROJECT_SHAPES` in @studio/song). */
  createProject: async (
    m: AccountFiles,
    workspace: string,
    name: string,
    shape: ProjectShape,
  ): Promise<{ project: string; missing: string[] }> => {
    const { project, missing } = await call<{
      project: string;
      missing?: string[];
    }>(m, `/project/create`, "create", {
      method: "POST",
      workspace,
      json: { shape, name },
    });
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
    return call(m, `/import-upload?${q}`, "import", {
      method: "POST",
      workspace,
      body: await file.arrayBuffer(),
      type: "application/octet-stream",
    });
  },

  /** Copy a project into another of the account's workspaces. No workspace HEADER: the body names both. */
  copyProject: async (
    m: AccountFiles,
    from: string,
    path: string,
    to: string,
    name: string,
  ): Promise<string> => {
    const { project } = await call<{ project: string }>(
      m,
      `/workspaces/copy-project`,
      "copy",
      { method: "POST", json: { from, path, to, name } },
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
    const { path: renamed } = await call<{ path: string }>(
      m,
      `/project/rename`,
      "rename",
      { method: "POST", workspace, json: { path, name } },
    );
    return renamed;
  },

  /** Delete a workspace — the folder and everything under it, for good. */
  removeWorkspace: async (
    m: AccountFiles,
    workspace: string,
  ): Promise<void> => {
    await call(m, `/workspaces/remove`, "delete", {
      method: "POST",
      json: { name: workspace },
    });
  },

  /** Unload the project and move its folder to the workspace's recycle bin. */
  deleteProject: async (
    m: AccountFiles,
    workspace: string,
    path: string,
  ): Promise<void> => {
    await call(m, `/project/delete`, "delete", {
      method: "POST",
      workspace,
      json: { path },
    });
  },
};

export const filesHeaders = (m: AccountFiles): Record<string, string> => ({
  [USER_HEADER]: m.userEmail,
  [ENGINE_TOKEN_HEADER]: m.token,
});
