// api.ts — the two services this screen talks to, and they are not the same machine:
// pl8 (same origin, session cookie) holds the REGISTER of repositories, the libraries pointer,
// the deploy key and the shares; the file service on the chosen ENGINE holds every working copy,
// so what projects EXIST — and creating, deleting and opening one — is its answer.
// See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song/yaml/projectSchema";
import {
  type CloneJob,
  ENGINE_TOKEN_HEADER,
  type FileNode,
  type MachineWorkspace,
  type MachineWorkspaceList,
  type RepoProject,
  type RepoRef,
  type RepoSummary,
  type ShareSummary,
  type SshKeyInfo,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import {
  launchUrl,
  localProjectUrl,
  shareUrl,
} from "@studio/web-protocol/projects";
import { serviceUrl } from "@studio/web-protocol/services";

/**
 * Where pl8 answers — another service on the SAME origin, under `/pl8`.
 *
 * DERIVED rather than declared: every studio service sits at a fixed path under one origin, so
 * dev and production differ by the origin the page was served from and nothing else. It was a
 * build-time branch naming a host of its own once, which is the same fact written twice and
 * only true until a deployment moves. It has since been worth the indirection twice over — this
 * constant needed no edit when the médiathèque stopped serving the origin root and moved under
 * a prefix, because the table it reads did.
 *
 * It lived in `../api` as an app-wide constant while the settings menu linked out to pl8's
 * Modules section. That section is gone — a module is authored here now — and the constant went
 * with its last caller. This screen is the new one, so it is spelled where it is used instead of
 * being put back at the top of the app for one importer.
 *
 * `globalThis.location`, not `window`: this module is imported by tests that run in node, where
 * reading `window` at module scope is a ReferenceError before any test has started.
 */
const PL8_URL = serviceUrl(globalThis.location?.origin ?? "", "pl8");

/** Where the catalogue answers — the header's link out. Exported for `Home.tsx`, which needs the
 *  address and none of the verbs below. */
export const pl8Url = (): string => PL8_URL;

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

// ── pl8: the repositories, the libraries, the key ───────────────────────────────
// `PL8_URL` and not a relative path: st0 is mounted at the origin ROOT now, so a bare
// `/api/projects` from here would be st0's own backend — which has no such route. It was a
// relative path that was wrong before the swap and an absolute one that is wrong after; only
// asking the table each time is right in both.

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

/**
 * The account's REGISTER of git repositories.
 *
 * pl8 answers, and always will: a repository belongs to a PERSON rather than to a machine, and
 * the hosted service is the one side that outlives every engine and holds the whole list. What
 * it no longer answers is what is INSIDE one — that was a bare blobless mirror of every
 * repository, and the machine's working copy is the better source for it. This list is now
 * read for one thing on this screen: whether `/<dépôt>/<projet>` will resolve. See
 * `projectHref` below and ../../docs/projects.md.
 */
export const projects = {
  list: () => pget<{ repos: RepoSummary[]; revision: string }>("", "projects"),
  revision: () => pget<{ revision: string }>("/revision", "revision"),
  add: (uri: string, label?: string) =>
    psend<{ repo: RepoSummary }>("POST", "", { uri, label }),
  remove: (id: string) => psend<{ ok: true }>("DELETE", `/${id}`),

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
};

/**
 * Whether `/<dépôt>/<projet>` will actually resolve for this workspace — the question only this
 * page can answer, because only this page talks to both services.
 *
 * Two halves, and they come from opposite ends. The MACHINE says whether the short name is
 * unique among its clones (`uniqueName`); pl8's REGISTRY says whether it knows that repository
 * at all, which is what `GET /api/projects/by-name/:name` is asked one click later. A clone this
 * machine has and that registry does not — added by hand, or removed from the list since — has a
 * perfectly good short name that resolves to a 404 at the gate.
 *
 * `registered` is the set of short names pl8 answered with.
 */
const namedByRepo = (ws: MachineWorkspace, registered: Set<string>): boolean =>
  ws.uniqueName && ws.repoName !== null && registered.has(ws.repoName);

/**
 * Where a project opens — st0 or z0, whichever its folder name claims, and by whichever of the
 * two addresses this workspace can be named by.
 *
 * The repository's address wins whenever it works, and that is the whole ordering: `/<dépôt>/…`
 * means the same song on ANY machine — it is what `projectClaimKey` identifies a project by, and
 * what a link pasted to somebody else has to be — while `@local` names a folder on this one and
 * nowhere else. So `@local` is the fallback, for a workspace that is no clone, one whose short
 * name is ambiguous, and one pl8's registry has never heard of.
 *
 * Built through `launchUrl` either way, even though this page IS st0: a `.z0` folder in the same
 * workspace opens somewhere else entirely, and the row that leads to it must not be the one link
 * on the screen that guesses. Still a new tab, too — see ../../docs/projects.md.
 */
export function projectHref(
  ws: MachineWorkspace,
  p: RepoProject,
  registered: Set<string>,
): string {
  return namedByRepo(ws, registered) && ws.repoName
    ? launchUrl(window.location.origin, ws.repoName, p.path, p.app)
    : localProjectUrl(window.location.origin, ws.name, p.path, p.app);
}

/** …and the same question on its own, for the row that wants to SAY which address it got. */
export const isRegistered = namedByRepo;

// ── pl8: the shares ─────────────────────────────────────────────────────────────

const sget = async <T>(path: string, what: string): Promise<T> =>
  json(await fetch(`${PL8_URL}/api/shares${path}`), what);

/**
 * The frozen snapshots this person has published, and taking one back.
 *
 * Both ends are st0's now. `project share link` renders the bundle here, on the machine that has
 * an engine, and uploads it to pl8 — which holds the only copy and serves it to people with no
 * account at all. This screen is where one is watched and withdrawn. See ../../docs/shares.md.
 */
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

  /** The link, built from the origin the browser is on. pl8 holds the secret and never the
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
  /**
   * Every workspace on this machine, with the projects in it — the list this page draws.
   *
   * The MACHINE answers what projects exist, and nothing else can: they are folders on its disk.
   * pl8 answered it for a while out of a bare blobless mirror of every repository, which was a
   * second copy of this one — a `git fetch` behind, and blind to a project committed here whose
   * push had not landed. See ../../docs/projects.md.
   */
  workspaces: async (m: Machine): Promise<MachineWorkspace[]> => {
    const { workspaces } = await json<MachineWorkspaceList>(
      await fetch(`${m.fileBase}/workspaces/projects`, {
        headers: machineHeaders(m),
      }),
      "workspaces",
    );
    return workspaces;
  },

  /** One workspace's whole tree — the "look inside" pane. `/workspace-tree` and not `/tree`:
   *  that one is the OPEN PROJECT's files, which is the editor's question and not this one. */
  workspaceTree: async (m: Machine, workspace: string): Promise<FileNode[]> =>
    json(
      await fetch(`${m.fileBase}/workspace-tree`, {
        headers: { ...machineHeaders(m), [WORKSPACE_HEADER]: workspace },
      }),
      "arborescence",
    ),

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
   * `name` already carries its suffix (`hiver.st0`): the service takes the raw name as the folder
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
