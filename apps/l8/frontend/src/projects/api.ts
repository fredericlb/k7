// api.ts — the two services this screen talks to, and they are not the same machine:
// st0 (same origin, session cookie) OWNS the repositories, the libraries, the deploy key and
// the shares; the file service on the chosen ENGINE owns every working copy, so creating and
// deleting a project happen there. Neither half moved when this screen did — only the drawing
// did. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song/yaml/projectSchema";
import {
  type CloneJob,
  ENGINE_TOKEN_HEADER,
  type FileNode,
  type RepoRef,
  type RepoStatus,
  type RepoSummary,
  type ShareSummary,
  type SshKeyInfo,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import {
  launchUrl,
  type ProjectApp,
  shareUrl,
} from "@studio/web-protocol/projects";
import { MEDIATEK_URL } from "../api";

/** The error the far side carried, or a status code when it carried none. Its `status` rides
 *  along: a 202 and a 404 are answers here, not failures, and callers tell them apart. */
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

// ── st0: the repositories, the libraries, the key ───────────────────────────────
// `MEDIATEK_URL` and not a relative path: l8 is mounted under `/l8` and st0 answers the origin
// root, so a bare `/api/projects` from here would be l8's own backend — which has no such route.

const pget = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${MEDIATEK_URL}/api/projects${path}`), what);

const psend = async <T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> =>
  json(
    await fetch(`${MEDIATEK_URL}/api/projects${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    path,
  );

/**
 * The account's git repositories.
 *
 * st0 answers, and always will: a repository belongs to a PERSON rather than to a machine, and
 * the hosted service is the one side that outlives every engine and holds the whole list. What
 * it keeps of one is a bare blobless mirror — enough to answer "what is in there" and nothing
 * more. The checkout is the engine's, further down. See ../../docs/projects.md.
 */
export const projects = {
  list: () => pget<{ repos: RepoSummary[]; revision: string }>("", "projects"),
  revision: () => pget<{ revision: string }>("/revision", "revision"),
  add: (uri: string, label?: string) =>
    psend<{ repo: RepoSummary }>("POST", "", { uri, label }),
  remove: (id: string) => psend<{ ok: true }>("DELETE", `/${id}`),
  refresh: (id: string) => psend<RepoStatus>("POST", `/${id}/refresh`),

  /**
   * The repository's tree. 202 means "known, but the mirror is still being fetched" — a state
   * of its own, and neither an error nor an empty repository, so it is returned rather than
   * thrown.
   */
  tree: async (
    id: string,
  ): Promise<{
    nodes: FileNode[];
    projects: { path: string; app: ProjectApp }[];
  } | null> => {
    const res = await fetch(`${MEDIATEK_URL}/api/projects/${id}/tree`);
    if (res.status === 202) return null;
    return json(res, "tree");
  },

  sshKey: () => pget<SshKeyInfo>("/ssh-key", "ssh-key"),
  generateSshKey: () => psend<SshKeyInfo>("POST", "/ssh-key", {}),

  /**
   * The LIBRARY repository — the modules and chains every project of this account inherits.
   *
   * `libraries: null` is the ordinary state of a new account and not an error, which is why the
   * route answers 200 with a null rather than a 404: this screen ACTS on it, and so does the
   * gate one click later, which will not open a project without one.
   */
  libraries: () =>
    pget<{ libraries: RepoRef | null }>("/libraries", "libraries"),
  /** SET, not add — there is one. Doing it twice with the same URI is doing it once. */
  setLibraries: (uri: string) =>
    psend<{ libraries: RepoRef }>("PUT", "/libraries", { uri }),

  /**
   * Where a project opens — l8 or z0, whichever its folder name claims.
   *
   * Still built through `launchUrl` even though this page IS l8: a `.z0` folder in the same
   * repository opens somewhere else entirely, and the row that leads to it must not be the one
   * link on the screen that guesses. Still a new tab, too, for the reason it always was — see
   * ../../docs/projects.md.
   */
  openIn: (repoName: string, project: string, app: ProjectApp): string =>
    launchUrl(window.location.origin, repoName, project, app),
};

// ── st0: the shares ─────────────────────────────────────────────────────────────

const sget = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${MEDIATEK_URL}/api/shares${path}`), what);

/**
 * The frozen snapshots this person has published, and taking one back.
 *
 * Both ends are l8's now. `project share link` renders the bundle here, on the machine that has
 * an engine, and uploads it to st0 — which holds the only copy and serves it to people with no
 * account at all. This screen is where one is watched and withdrawn. See ../../docs/shares.md.
 */
export const shares = {
  list: () => sget<{ shares: ShareSummary[]; revision: string }>("", "shares"),
  revision: () => sget<{ revision: string }>("/revision", "revision"),

  /** Delete the bytes. The row stays, dated — the list keeps saying what was published. */
  revoke: async (key: string): Promise<void> => {
    const res = await fetch(`${MEDIATEK_URL}/api/shares/${key}`, {
      method: "DELETE",
    });
    if (!res.ok) throw await failed(res, "revoke");
  },

  /** The link, built from the origin the browser is on. st0 holds the secret and never the
   *  address: which host this account is read on is a property of the tab, not of the snapshot. */
  url: (token: string): string => shareUrl(window.location.origin, token),
};

// ── the chosen engine's file service: the working copies ────────────────────────

/** The machine chosen for this screen: its file service, and the token that opens the door. */
export interface Machine {
  fileBase: string;
  token: string;
  /** Who is asking. The file service trusts the header (Phase-2 local trust); this page reads
   *  it off `/auth/me` rather than off a configured workspace, having none. */
  userEmail: string;
}

/**
 * The file-service calls this page makes, each carrying its machine explicitly.
 *
 * Explicit, rather than through the module-wide `configureFileApi` the editor uses: that one is
 * set ONCE, on the single workspace a tab has a project open in, and this page touches a
 * different repository on every row — several of them before anything is open at all.
 */
export const engineMachine = {
  /** Does this machine already hold this repository? A NORMALISED comparison on the far side —
   *  the two ends learned the address by different routes. See packages/git-repos/src/uri.ts. */
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

  /** Start the clone, and hand back the job to poll: a real repository takes tens of seconds,
   *  which is longer than a request should stay open. */
  startClone: async (m: Machine, uri: string): Promise<CloneJob> =>
    json(
      await fetch(`${m.fileBase}/workspaces/clone`, {
        method: "POST",
        headers: { ...machineHeaders(m), "content-type": "application/json" },
        body: JSON.stringify({ uri }),
      }),
      "clone",
    ),

  /** …and poll it. `null` for a job the machine has forgotten: it keeps finished ones only a
   *  few minutes, and claiming success for one nobody holds the state of would be worse. */
  cloneJob: async (m: Machine, id: string): Promise<CloneJob | null> => {
    const res = await fetch(
      `${m.fileBase}/workspaces/clone/${encodeURIComponent(id)}`,
      { headers: machineHeaders(m) },
    );
    if (res.status === 404) return null;
    return json(res, "clone");
  },

  /**
   * Scaffold a project in this machine's workspace.
   *
   * `name` already carries its suffix (`hiver.l8`): the service takes the raw name as the folder
   * name. `shape` is the ARCHETYPE — `arrangement`, `mix` or `video` — which cannot travel in
   * the name, and that is why it is a field. A file service older than those three names answers
   * 400 on its `z.enum`, which is the right failure: "unknown archetype" beats a template
   * guessed wrong. See `PROJECT_SHAPES` in @studio/song.
   */
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

  /** Unload the project and recycle its folder. The service bins it rather than erasing it —
   *  it is the commit that follows which takes it out of the repository. */
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
