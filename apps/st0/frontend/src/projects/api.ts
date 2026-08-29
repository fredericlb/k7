// api.ts — the two services this screen talks to, and they are not the same machine:
// pl8 (same origin, session cookie) holds the REGISTER of repositories, the libraries pointer,
// the deploy key and the shares; the file service on the chosen ENGINE holds every working copy,
// so what projects EXIST — and creating, deleting and opening one — is its answer.
// See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import {
  type CloneJob,
  ENGINE_TOKEN_HEADER,
  type FileNode,
  type MachineWorkspace,
  type MachineWorkspaceList,
  type RepoProject,
  type RepoRef,
  type RepoSummary,
  type ServedProject,
  type ServedProjectReply,
  type ShareSummary,
  type SshKeyInfo,
  type SurfacedProject,
  type SurfacedProjectList,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import {
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

// ── pl8: the repositories, the libraries, the key ───────────────────────────────

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

  /** The LIBRARY repository — `libraries: null` is the ordinary state of a new account, hence a 200 with a null rather than a 404. */
  libraries: () =>
    pget<{ libraries: RepoRef | null }>("/libraries", "libraries"),
  /** SET, not add — there is one. Doing it twice with the same URI is doing it once. */
  setLibraries: (uri: string) =>
    psend<{ libraries: RepoRef }>("PUT", "/libraries", { uri }),
};

/** The three fields an address is chosen from — narrower than `MachineWorkspace` on purpose, the surfaces listing carrying the same identity flattened. */
type Addressable = Pick<MachineWorkspace, "name" | "repoName" | "uniqueName">;

const namedByRepo = (ws: Addressable, registered: Set<string>): boolean =>
  ws.uniqueName && ws.repoName !== null && registered.has(ws.repoName);

/** Where a project opens — st0 or z0 by its folder name, at the repository's address whenever it works and `@local` otherwise (../../docs/projects.md). */
export function projectHref(
  ws: Addressable,
  p: RepoProject,
  registered: Set<string>,
): string {
  return namedByRepo(ws, registered) && ws.repoName
    ? launchUrl(window.location.origin, ws.repoName, p.path, p.app)
    : localProjectUrl(window.location.origin, ws.name, p.path, p.app);
}

/** …and the same question on its own, for the row that wants to SAY which address it got. */
export const isRegistered = namedByRepo;

/** Where ONE SURFACE of that project opens, on its own — through `projectHref`, so the tablet and the laptop claim the same song. */
export function externalHref(
  row: SurfacedProject,
  surface: string,
  registered: Set<string>,
): string {
  const ws: Addressable = {
    name: row.workspace,
    repoName: row.repoName,
    uniqueName: row.uniqueName,
  };
  return externalOf(
    projectHref(ws, { path: row.path, app: row.app }, registered),
    surface,
  );
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

  /** One workspace's whole tree — `/workspace-tree` and not `/tree`, which is the OPEN PROJECT's files. */
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

  /** Unload the project and recycle its folder — the commit that follows is what takes it out of the repository. */
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
