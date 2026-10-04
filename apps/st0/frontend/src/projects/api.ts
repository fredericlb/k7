// api.ts — the two services this screen talks to: pl8 holds the SHARES and nothing about git;
// the account's file service, on the server, holds every working copy, the deploy key and the
// libraries pointer, so what projects EXIST — and creating, deleting and opening one — is its answer.
//
// Every call to it names its `AccountFiles` (that service and its ticket): this screen opens no project,
// so `fileApi`'s module-level transport is unconfigured here and would throw. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import {
  type AccountLibrariesReply,
  type AccountWorkspace,
  type AccountWorkspaceList,
  type CloneJob,
  type ColdChainsReply,
  type CommentState,
  type CompactWorkspaceReply,
  ENGINE_TOKEN_HEADER,
  type FileNode,
  type ModelDownloadJob,
  type RepoProject,
  type ServedProject,
  type ServedProjectReply,
  type ShareComment,
  type ShareSummary,
  type SshKeyInfo,
  type SurfacedProject,
  type SurfacedProjectList,
  USER_HEADER,
  WORKSPACE_HEADER,
  type WorkspaceSync,
  type WorkspaceSyncList,
} from "@studio/web-protocol";
import {
  BENCH_PROJECT,
  BENCH_REPO,
  externalOf,
  launchUrl,
  localProjectUrl,
  shareUrl,
} from "@studio/web-protocol/projects";
import { serviceUrl } from "@studio/web-protocol/services";

/** Where pl8 answers — another service on the SAME origin, DERIVED from the services table rather than declared (`globalThis.location`, for node tests). */
const PL8_URL = serviceUrl(globalThis.location?.origin ?? "", "pl8");

/**
 * Where the catalogue answers — the header's link out; exported for the two screens that need
 * the address and none of the verbs. Pass the DESKTOP's configured server to get that server's
 * catalogue: on the desktop our own origin holds the offline shim, which answers pl8's API
 * routes and serves none of its screens, so linking there gives a 503 rather than a library.
 */
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

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw await failed(res, what);
  return (await res.json()) as T;
}

// ── pl8: what is left of it here ─────────────────────────────────────────────

// `PL8_URL` and not a relative path: st0 is mounted at the origin ROOT, so a bare `/api/shares` would reach st0's own backend.

/** The three fields an address is chosen from — narrower than `AccountWorkspace` on purpose, the surfaces listing carrying the same identity flattened. */
type Addressable = Pick<AccountWorkspace, "name" | "repoName" | "uniqueName">;

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
  return localProjectUrl(window.location.origin, ws.name, ".", "st0");
}

/** Where the BENCH opens: `/@banc/live.st0`, the one address it answers — see apps/pl8/docs/banc.md. */
export function benchHref(): string {
  return launchUrl(window.location.origin, BENCH_REPO, BENCH_PROJECT, "st0");
}

/** Where ONE SURFACE of that project opens, on its own — through `projectHref`, so the tablet and the laptop claim the same song. */
export function externalHref(row: SurfacedProject, surface: string): string {
  const ws: Addressable = {
    name: row.workspace,
    repoName: row.repoName,
    uniqueName: row.uniqueName,
  };
  return externalOf(projectHref(ws, { path: row.path, app: row.app }), surface);
}

// ── pl8: the shares ─────────────────────────────────────────────────────────────

const sget = async <T>(path: string, what: string): Promise<T> =>
  json(
    await fetch(`${PL8_URL}/api/shares${path}`, { credentials: "include" }),
    what,
  );

/** The frozen snapshots this person has published, and taking one back — both ends st0's (../../docs/projects.md). */
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

/** The file-service calls this page makes, each carrying its file service explicitly: a row touches a different repository every time. */
export const accountFiles = {
  /**
   * The LIBRARIES the account holds — an empty list is the ordinary state of a new one. They were
   * pl8's until pl8 stopped knowing about git, and one repository until they had names.
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

  /** SET the whole list — the far side CLONES any library new to it before it writes it down, and drops the clones of those it lost. */
  setLibraries: async (
    m: AccountFiles,
    libraries: { name?: string; uri: string }[],
  ): Promise<AccountLibrariesReply> =>
    json<AccountLibrariesReply>(
      await fetch(`${m.fileBase}/account/libraries`, {
        method: "PUT",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ libraries }),
      }),
      "libraries",
    ),

  /** Bring every library to its latest commit now, rather than at the next open. */
  updateLibraries: async (m: AccountFiles): Promise<AccountLibrariesReply> =>
    json<AccountLibrariesReply>(
      await fetch(`${m.fileBase}/account/libraries/update`, {
        method: "POST",
        headers: filesHeaders(m),
      }),
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

  /** The account's deploy key, MADE by its file service and never leaving the server. */
  sshKey: async (m: AccountFiles): Promise<SshKeyInfo> =>
    json(
      await fetch(`${m.fileBase}/ssh-key`, { headers: filesHeaders(m) }),
      "ssh-key",
    ),

  /** Make one, if there is none — idempotent, so a second press returns the first key. */
  createSshKey: async (m: AccountFiles): Promise<SshKeyInfo> =>
    json(
      await fetch(`${m.fileBase}/ssh-key`, {
        method: "POST",
        headers: filesHeaders(m),
      }),
      "ssh-key",
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

  /** Does the account already hold this repository? A NORMALISED comparison on the far side (packages/git-repos/src/uri.ts). */
  workspaceForRepo: async (
    m: AccountFiles,
    uri: string,
  ): Promise<string | null> => {
    const { workspace } = await json<{ workspace: string | null }>(
      await fetch(
        `${m.fileBase}/workspaces/by-repo?uri=${encodeURIComponent(uri)}`,
        { headers: filesHeaders(m) },
      ),
      "workspace",
    );
    return workspace ?? null;
  },

  /** A workspace and NOTHING else: git-initialised, with no repository behind it. */
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

  /** …and give it its first repository: the remote, and the push onto it, in one call. */
  setRemote: async (
    m: AccountFiles,
    workspace: string,
    uri: string,
  ): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces/remote`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name: workspace, uri }),
      }),
      "publish",
    );
  },

  /** Start the clone, and hand back the job to poll: a real repository takes tens of seconds. */
  startClone: async (m: AccountFiles, uri: string): Promise<CloneJob> =>
    json(
      await fetch(`${m.fileBase}/workspaces/clone`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ uri }),
      }),
      "clone",
    ),

  /** …and poll it; `null` for a job the server has forgotten, finished ones being kept only a few minutes. */
  cloneJob: async (m: AccountFiles, id: string): Promise<CloneJob | null> => {
    const res = await fetch(
      `${m.fileBase}/workspaces/clone/${encodeURIComponent(id)}`,
      { headers: filesHeaders(m) },
    );
    if (res.status === 404) return null;
    return json(res, "clone");
  },

  /** Scaffold a project in one of the account's workspaces: `name` carries its suffix, and `shape` is the ARCHETYPE (`PROJECT_SHAPES` in @studio/song). */
  createProject: async (
    m: AccountFiles,
    workspace: string,
    name: string,
    shape: ProjectShape,
  ): Promise<string> => {
    const { project } = await json<{ project: string }>(
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
    return project;
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

  /** Rename a project's FOLDER in place; the suffix stays, and the commit that follows carries it off this disk. */
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

  /** Unload the project and recycle its folder — the commit that follows is what takes it out of the repository. */
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

  /** Where every workspace stands against its repository — slow-polled, since it fetches. */
  workspaceSync: async (m: AccountFiles): Promise<WorkspaceSync[]> =>
    (
      await json<WorkspaceSyncList>(
        await fetch(`${m.fileBase}/workspaces/sync`, {
          headers: filesHeaders(m),
        }),
        "sync",
      )
    ).workspaces,

  /** Shrink a workspace's repository to its working tree — the bin emptied, the history one commit. */
  compactWorkspace: async (
    m: AccountFiles,
    workspace: string,
  ): Promise<CompactWorkspaceReply> =>
    json(
      await fetch(`${m.fileBase}/workspaces/compact`, {
        method: "POST",
        headers: { ...filesHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name: workspace }),
      }),
      "compact",
    ),

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

  /** One command line, run in that workspace — here, only the two git verbs. */
  command: async (
    m: AccountFiles,
    workspace: string,
    line: string,
  ): Promise<string[]> => {
    const { output } = await json<{ output: string[] }>(
      await fetch(`${m.fileBase}/command`, {
        method: "POST",
        headers: {
          ...filesHeaders(m),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ line }),
      }),
      "command",
    );
    return output ?? [];
  },
};

const filesHeaders = (m: AccountFiles): Record<string, string> => ({
  [USER_HEADER]: m.userEmail,
  [ENGINE_TOKEN_HEADER]: m.token,
});
