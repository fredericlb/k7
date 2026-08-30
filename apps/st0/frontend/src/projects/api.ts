// api.ts — the two services this screen talks to, and they are not the same machine:
// pl8 (same origin, session cookie) holds the SHARES and nothing about git; the file service on
// the chosen ENGINE holds every working copy, the deploy key and the libraries pointer, so what
// projects EXIST — and creating, deleting and opening one — is its answer.
//
// Every call to it names its MACHINE: this screen opens no project, so `fileApi`'s module-level
// transport is unconfigured here and would throw. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import {
  type CloneJob,
  type CommentState,
  ENGINE_TOKEN_HEADER,
  type FileNode,
  type MachineWorkspace,
  type MachineWorkspaceList,
  type RepoProject,
  type RepoRef,
  type RepoSummary,
  type ServedProject,
  type ServedProjectReply,
  type ShareComment,
  type ShareSummary,
  type SshKeyInfo,
  type SurfacedProject,
  type SurfacedProjectList,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import {
  externalOf,
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

// `PL8_URL` and not a relative path: st0 is mounted at the origin ROOT, so a bare `/api/projects` would reach st0's own backend.

const pget = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${PL8_URL}/api/projects${path}`), what);

const psend = async <T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> =>
  json(
    await fetch(`${PL8_URL}/api/projects${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    path,
  );

/** The account's REGISTER of git repositories — pl8 answers, and always will; what is INSIDE one is the machine's (../../docs/projects.md). */
export const projects = {
  list: () => pget<{ repos: RepoSummary[]; revision: string }>("", "projects"),
  revision: () => pget<{ revision: string }>("/revision", "revision"),
  add: (uri: string, label?: string) =>
    psend<{ repo: RepoSummary }>("POST", "", { uri, label }),
  remove: (id: string) => psend<{ ok: true }>("DELETE", `/${id}`),

  sshKey: () => pget<SshKeyInfo>("/ssh-key", "ssh-key"),
  generateSshKey: () => psend<SshKeyInfo>("POST", "/ssh-key", {}),

  /** SET, not add — there is one. Doing it twice with the same URI is doing it once. */
};

/** The three fields an address is chosen from — narrower than `MachineWorkspace` on purpose, the surfaces listing carrying the same identity flattened. */
type Addressable = Pick<MachineWorkspace, "name" | "repoName" | "uniqueName">;

/** Where a project opens. ALWAYS `@local`: a project is a folder on the machine that holds it,
 *  and no service outlives that machine to say otherwise (../../docs/projects.md). */
export function projectHref(ws: Addressable, p: RepoProject): string {
  return localProjectUrl(window.location.origin, ws.name, p.path, p.app);
}

/**
 * Where the WORKSPACE itself opens — the same choice of address with `.` for the project, which
 * the machine then resolves: the one last open, else the first, else the first-project wizard.
 * This is the only way into a workspace that holds nothing (../../docs/projects.md).
 */
export function workspaceHref(ws: Addressable): string {
  return localProjectUrl(window.location.origin, ws.name, ".", "st0");
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
  json(await fetch(`${PL8_URL}/api/shares${path}`), what);

/** The frozen snapshots this person has published, and taking one back — both ends st0's (../../docs/projects.md). */
export const shares = {
  list: () => sget<{ shares: ShareSummary[]; revision: string }>("", "shares"),
  revision: () => sget<{ revision: string }>("/revision", "revision"),

  /** Delete the bytes. The row stays, dated — the list keeps saying what was published. */
  revoke: async (key: string): Promise<void> => {
    const res = await fetch(`${PL8_URL}/api/shares/${key}`, {
      method: "DELETE",
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) throw await failed(res, "comment");
  },

  /** The link, built from the origin the browser is on: pl8 holds the secret and never the address. */
  url: (token: string): string => shareUrl(window.location.origin, token),
};

// ── the chosen engine's file service: the working copies ────────────────────────

/** The machine chosen for this screen: its file service, and the token that opens the door. */
export interface Machine {
  fileBase: string;
  token: string;
  /** Who is asking — read off `/auth/me` rather than off a configured workspace, this page having none. */
  userEmail: string;
}

/** The file-service calls this page makes, each carrying its machine explicitly: a row touches a different repository every time. */
export const engineMachine = {
  /**
   * The LIBRARY repository this machine holds — `null` is the ordinary state of a new one, hence
   * a 200 with a null rather than a 404. It was pl8's until pl8 stopped knowing about git.
   *
   * Named machine and not through `fileApi`: this screen opens no project, so the module-level
   * transport is unconfigured and `cfg()` would throw "no project opened yet" (../../docs/projects.md).
   */
  libraries: async (m: Machine): Promise<RepoRef | null> => {
    const { libraries } = await json<{ libraries: RepoRef | null }>(
      await fetch(`${m.fileBase}/account/libraries`, {
        headers: machineHeaders(m),
      }),
      "libraries",
    );
    return libraries;
  },

  /** SET it — the same URI twice is the same as once. */
  setLibraries: async (m: Machine, uri: string): Promise<RepoRef> => {
    const { libraries } = await json<{ libraries: RepoRef }>(
      await fetch(`${m.fileBase}/account/libraries`, {
        method: "PUT",
        headers: { ...machineHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ uri }),
      }),
      "libraries",
    );
    return libraries;
  },

  /** Every workspace on this machine, with the projects in it — the MACHINE answers, they being folders on its disk. */
  workspaces: async (m: Machine): Promise<MachineWorkspace[]> => {
    const { workspaces } = await json<MachineWorkspaceList>(
      await fetch(`${m.fileBase}/workspaces/projects`, {
        headers: machineHeaders(m),
      }),
      "workspaces",
    );
    return workspaces;
  },

  /** The same disk, asked what could be put on a SECOND DEVICE — its own route, the home page drawing no surfaces (../../docs/external.md). */
  surfacedProjects: async (m: Machine): Promise<SurfacedProject[]> => {
    const { projects } = await json<SurfacedProjectList>(
      await fetch(`${m.fileBase}/workspaces/surfaces`, {
        headers: machineHeaders(m),
      }),
      "surfaces",
    );
    return projects;
  },

  /** …and which ONE of those the engine is holding for this person: one answer per account, unlike each row's `.studio-active`. */
  servedProject: async (m: Machine): Promise<ServedProject | null> => {
    const { project } = await json<ServedProjectReply>(
      await fetch(`${m.fileBase}/engine/served`, {
        headers: machineHeaders(m),
      }),
      "served",
    );
    return project;
  },

  /** One workspace's whole tree, asked of a workspace this page has not opened — `/tree` needs one. */
  workspaceTree: async (m: Machine, workspace: string): Promise<FileNode[]> =>
    json(
      await fetch(`${m.fileBase}/workspace-tree`, {
        headers: { ...machineHeaders(m), [WORKSPACE_HEADER]: workspace },
      }),
      "arborescence",
    ),

  /** Does this machine already hold this repository? A NORMALISED comparison on the far side (packages/git-repos/src/uri.ts). */
  workspaceForRepo: async (m: Machine, uri: string): Promise<string | null> => {
    const { workspace } = await json<{ workspace: string | null }>(
      await fetch(
        `${m.fileBase}/workspaces/by-repo?uri=${encodeURIComponent(uri)}`,
        { headers: machineHeaders(m) },
      ),
      "workspace",
    );
    return workspace ?? null;
  },

  /** A workspace on this machine and NOTHING else: git-initialised, with no repository behind it. */
  createWorkspace: async (m: Machine, name: string): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces`, {
        method: "POST",
        headers: { ...machineHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
      "espace de travail",
    );
  },

  /** …and give it its first repository: the remote, and the push onto it, in one call. */
  setRemote: async (
    m: Machine,
    workspace: string,
    uri: string,
  ): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces/remote`, {
        method: "POST",
        headers: { ...machineHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name: workspace, uri }),
      }),
      "publication",
    );
  },

  /** Start the clone, and hand back the job to poll: a real repository takes tens of seconds. */
  startClone: async (m: Machine, uri: string): Promise<CloneJob> =>
    json(
      await fetch(`${m.fileBase}/workspaces/clone`, {
        method: "POST",
        headers: { ...machineHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ uri }),
      }),
      "clone",
    ),

  /** …and poll it; `null` for a job the machine has forgotten, finished ones being kept only a few minutes. */
  cloneJob: async (m: Machine, id: string): Promise<CloneJob | null> => {
    const res = await fetch(
      `${m.fileBase}/workspaces/clone/${encodeURIComponent(id)}`,
      { headers: machineHeaders(m) },
    );
    if (res.status === 404) return null;
    return json(res, "clone");
  },

  /** Scaffold a project in this machine's workspace: `name` carries its suffix, and `shape` is the ARCHETYPE (`PROJECT_SHAPES` in @studio/song). */
  createProject: async (
    m: Machine,
    workspace: string,
    name: string,
    shape: ProjectShape,
  ): Promise<string> => {
    const { project } = await json<{ project: string }>(
      await fetch(`${m.fileBase}/project/create`, {
        method: "POST",
        headers: {
          ...machineHeaders(m),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ shape, name }),
      }),
      "création",
    );
    return project;
  },

  /** Copy a project into another workspace on this machine. No workspace HEADER: the body names both. */
  copyProject: async (
    m: Machine,
    from: string,
    path: string,
    to: string,
    name: string,
  ): Promise<string> => {
    const { project } = await json<{ project: string }>(
      await fetch(`${m.fileBase}/workspaces/copy-project`, {
        method: "POST",
        headers: { ...machineHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ from, path, to, name }),
      }),
      "copie",
    );
    return project;
  },

  /** Unload the project and recycle its folder — the commit that follows is what takes it out of the repository. */
  /** Remove a workspace from the machine — the folder and everything under it, for good. */
  removeWorkspace: async (m: Machine, workspace: string): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/workspaces/remove`, {
        method: "POST",
        headers: { ...machineHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ name: workspace }),
      }),
      "suppression",
    );
  },

  deleteProject: async (
    m: Machine,
    workspace: string,
    path: string,
  ): Promise<void> => {
    await json(
      await fetch(`${m.fileBase}/project/delete`, {
        method: "POST",
        headers: {
          ...machineHeaders(m),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ path }),
      }),
      "suppression",
    );
  },

  /** One command line, run in that workspace — here, only the two git verbs. */
  command: async (
    m: Machine,
    workspace: string,
    line: string,
  ): Promise<string[]> => {
    const { output } = await json<{ output: string[] }>(
      await fetch(`${m.fileBase}/command`, {
        method: "POST",
        headers: {
          ...machineHeaders(m),
          [WORKSPACE_HEADER]: workspace,
          "content-type": "application/json",
        },
        body: JSON.stringify({ line }),
      }),
      "commande",
    );
    return output ?? [];
  },
};

const machineHeaders = (m: Machine): Record<string, string> => ({
  [USER_HEADER]: m.userEmail,
  [ENGINE_TOKEN_HEADER]: m.token,
});
