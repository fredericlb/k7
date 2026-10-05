// workspaces.ts — the live set of Workspace instances, one per (userSlug, workspace),
// plus listing a user's workspaces for the picker.

import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertSshGitUri,
  normalizeGitUri,
  repoName,
  repoNameOfKey,
} from "@studio/git-repos/uri";
import { accountLibraries } from "@studio/song/sharedFolders";
import { projectSurfaces } from "@studio/song/surfaces";
import type {
  AccountWorkspace,
  CloneStep,
  SurfacedProject,
  WorkspaceSummary,
} from "@studio/web-protocol";
import { projectApp } from "@studio/web-protocol/projects";
import { BENCH_WORKSPACE } from "./bench.ts";
import { pullLfs, setUpLfs } from "./gitLfs.ts";
import { refreshLibraries, retireWorkspaceLibraries } from "./libraries.ts";
import { closeModuleWatchesUnder } from "./moduleWatch.ts";
import { rootDir, slugify, workspaceRoot } from "./slug.ts";
import { ensureKey, sshCommand } from "./sshKeys.ts";
import {
  activeMarkerOf,
  isProjectDir,
  projectDirsUnder,
  readActiveMarker,
  Workspace,
} from "./workspace.ts";

const run = promisify(execFile);

// Memoized so a workspace's caches (compiled doc, waveforms) persist across requests.
const live = new Map<string, Workspace>();

/** Thrown when a request names a workspace that isn't there, as a type so the HTTP layer can answer 404. */
export class UnknownWorkspaceError extends Error {
  constructor(name: string) {
    super(`unknown workspace: ${name}`);
    this.name = "UnknownWorkspaceError";
  }
}

/** The Workspace for an EXISTING folder — opening does NOT create, see docs/workspaces.md. */
export function getWorkspace(userEmail: string, workspace: string): Workspace {
  const slug = slugify(userEmail);
  const key = `${slug}/${workspace}`;
  // workspaceRoot() throws on a traversing/empty name; that stays a 400.
  const root = workspaceRoot(workspace);
  // Before the memo, every call: a folder deleted from Finder would else be served from cache and 500 deep in fs.
  if (!existsSync(root)) {
    live.delete(key);
    throw new UnknownWorkspaceError(workspace);
  }
  let ws = live.get(key);
  if (!ws) {
    ws = new Workspace(root);
    live.set(key, ws);
  }
  return ws;
}

/** Every workspace currently open, for the machine-wide jobs that have no request to hang off. */
export function liveWorkspaces(): Workspace[] {
  return [...live.values()];
}

/**
 * What a workspace this service made ignores. A clone brings its own; this is the list for one
 * that never had an author to write it — see docs/workspaces.md.
 */
const GITIGNORE = ["_recycle_bin/", "_history/", "*.cache", ""].join("\n");

/** Create a workspace folder, git-initialised with NO remote. Returns false if it was already there. */
export async function createWorkspace(
  userEmail: string,
  workspace: string,
): Promise<boolean> {
  const slug = slugify(userEmail);
  const root = workspaceRoot(workspace);
  if (existsSync(root)) return false;
  mkdirSync(root, { recursive: true });
  const env = gitEnvFor(userEmail);
  try {
    await run("git", ["init", "-b", "main"], {
      cwd: root,
      env,
      timeout: 10_000,
    });
    writeFileSync(join(root, ".gitignore"), GITIGNORE, "utf8");
    // Not hygiene: `gitEnvFor` pins GIT_CONFIG_GLOBAL to /dev/null, so a machine with a git
    // identity has none HERE, and the first commit would fail with "Please tell me who you are".
    await run("git", ["config", "user.email", userEmail], {
      cwd: root,
      env,
      timeout: 10_000,
    });
    await run(
      "git",
      ["config", "user.name", userEmail.split("@")[0] || "studio"],
      {
        cwd: root,
        env,
        timeout: 10_000,
      },
    );
    // Last, so a machine with no git-lfs still gets the identity the first commit needs.
    await setUpLfs(root, env);
  } catch (e) {
    // The folder is there and usable; only versioning is missing, which `project commit` will say.
    console.warn(`[workspaces] git init ${workspace}: ${(e as Error).message}`);
  }
  forgetListing(slug); // a folder this service just made must not wait out the window
  return true;
}

/**
 * Give a local workspace its first remote and push onto it — see docs/workspaces.md.
 * Throws git's own stderr: "Permission denied (publickey)" is the whole answer, and ours
 * would be worse.
 */
export async function setWorkspaceRemote(
  userEmail: string,
  workspace: string,
  uri: string,
): Promise<void> {
  assertSshGitUri(uri);
  const slug = slugify(userEmail);
  const root = workspaceRoot(workspace);
  if (!existsSync(root)) throw new UnknownWorkspaceError(workspace);
  // Re-pointing a workspace at another repository is a different act, and not this one.
  if (await remoteOf(slug, workspace))
    throw new Error(
      `${workspace} already has a repository — publishing is for a workspace that has none`,
    );
  const env = gitEnvFor(userEmail);
  const git = (args: string[], timeout: number) =>
    run("git", args, { cwd: root, env, timeout });
  try {
    await git(["remote", "add", "origin", "--", uri], 10_000);
    await git(["push", "-u", "origin", "HEAD"], 120_000);
  } catch (e) {
    // Leave nothing half-published: a workspace with an origin it never reached reads as done.
    await git(["remote", "remove", "origin"], 10_000).catch(() => {});
    throw new Error(gitSaid(e));
  } finally {
    // Both caches: the row's origin is read from one and drawn from the other.
    forgetRemotes(slug);
    forgetListing(slug);
  }
}

/** git's stderr, which is the message worth showing — `execFile` puts ours in `message`. */
function gitSaid(e: unknown): string {
  const err = e as { stderr?: string; message?: string };
  return (err.stderr || err.message || "git failed").trim();
}

// Re-exported: the rule moved to @studio/git-repos when pl8 needed it too, and callers here need not know.
export { assertSshGitUri };

export function gitEnvFor(userEmail: string): NodeJS.ProcessEnv {
  const name = userEmail.split("@")[0] || "studio";
  return {
    ...process.env,
    // A clone and the hosted container carry no identity, and the global one is blanked below.
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: userEmail,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: userEmail,
    GIT_SSH_COMMAND: sshCommand(userEmail),
    GIT_TERMINAL_PROMPT: "0", // fail rather than prompt (no terminal to answer)
    // Load-bearing, not hygiene: a personal `insteadOf` rewrite turns the SSH URI back to https.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/** What a clone reports as it runs — enough to draw a bar and to say what went wrong. */
export interface CloneProgress {
  step: CloneStep;
  phase: string;
  percent: number | null;
  line: string;
}

/** Clone an SSH git repository as a new workspace, throwing git's own stderr — see docs/cloneJobs.md. */
export async function cloneWorkspace(
  userEmail: string,
  workspace: string,
  uri: string,
  onProgress?: (p: CloneProgress) => void,
): Promise<void> {
  assertSshGitUri(uri);
  const slug = slugify(userEmail);
  const root = workspaceRoot(workspace); // validates the name
  if (existsSync(root))
    throw new Error(`workspace already exists: ${workspace}`);
  // Throws NoKeyError with a sentence naming the fix; pl8 owns the key, this machine holds a copy.
  await ensureKey(userEmail);
  mkdirSync(rootDir(), { recursive: true });
  const env = gitEnvFor(userEmail);
  try {
    await gitClone(uri, root, env, onProgress);
  } catch (e) {
    // `root` didn't exist above, so whatever is there is our debris — a half-clone must not survive in the picker.
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
  // Before the media, so a workspace that is ON DISK is one the listing can already see.
  forgetRemotes(slug);
  forgetListing(slug);

  // The LIBRARIES, here rather than at the first open: the hub's clones brought up to date,
  // and a workspace committed when libraries were a submodule taken out of that arrangement.
  // Non-fatal for the same reason the media fetch is — the workspace is cloned, and this says so
  // instead of undoing it.
  if (accountLibraries().length)
    try {
      onProgress?.({
        step: "libraries",
        phase: "libraries",
        percent: null,
        line: "LIBRARIES: updating",
      });
      await refreshLibraries();
      const retired = await retireWorkspaceLibraries(userEmail, root);
      if (retired)
        onProgress?.({
          step: "libraries",
          phase: "libraries",
          percent: null,
          line: `LIBRARIES: ${retired.note}`,
        });
    } catch (e) {
      onProgress?.({
        step: "libraries",
        phase: "libraries",
        percent: null,
        line: `LIBRARIES: ${(e as Error).message}`,
      });
    }
  // The clone brought pointers rather than audio: this service hides the machine's git config.
  // A failure HERE leaves the workspace standing and merely reports — see docs/workspaces.md.
  // Its meter carries a percentage, and a fetch now allowed to take an hour needs to show one:
  // `parse` already reads `(\d+)%` out of a line, and the phase is ours rather than git-lfs's.
  await pullLfs(root, uri, env, (line) =>
    onProgress?.({ ...parse(line, "media"), phase: "LFS" }),
  );
}

/** `--progress` because git only writes counters when it thinks it has a terminal. */
/** How long git may say NOTHING before it is presumed stuck — never how long it may take. */
const CLONE_IDLE_MS = 120_000;

function gitClone(
  uri: string,
  root: string,
  env: NodeJS.ProcessEnv,
  onProgress?: (p: CloneProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", "--progress", "--", uri, root], {
      env,
      // No stdin, so a prompt fails rather than waits; stdout ignored, so it can never fill and block.
      stdio: ["ignore", "ignore", "pipe"],
    });
    let tail = "";
    const stderr: string[] = [];
    // SILENCE, not duration: `--progress` means git speaks while it works, so a clone that is
    // getting somewhere resets this however long it takes. A total cap killed a repository that
    // simply had a lot of audio in it, and the half-clone was then removed — the workspace
    // appeared while cloning and vanished when it "finished". See docs/workspaces.md.
    let timer = setTimeout(() => child.kill(), CLONE_IDLE_MS);
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => child.kill(), CLONE_IDLE_MS);
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      alive();
      // \r as well as \n: git rewrites the counter line in place rather than emitting new ones.
      const parts = (tail + chunk).split(/\r\n|[\r\n]/);
      tail = parts.pop() ?? "";
      for (const line of parts) {
        const text = line.trim();
        if (!text) continue;
        // Kept whole for the error message; git's last words are the useful ones.
        stderr.push(text);
        if (stderr.length > 200) stderr.shift();
        onProgress?.(parse(text));
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        (e as { code?: string }).code === "ENOENT"
          ? new Error(
              "the 'git' CLI is required — install it from https://git-scm.com",
            )
          : e,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // git's own words, not ours: "Permission denied (publickey)" is the whole answer.
      reject(
        new Error(stderr.join("\n").trim() || `git clone failed (${code})`),
      );
    });
  });
}

function parse(line: string, step: CloneStep = "clone"): CloneProgress {
  const pct = /(\d+)%/.exec(line);
  const colon = line.indexOf(":");
  return {
    step,
    phase: colon > 0 ? line.slice(0, colon).trim() : line,
    percent: pct ? Number(pct[1]) : null,
    line,
  };
}

// A workspace's remote, by name: `git config` per workspace on every lookup would be a subprocess per poll.
const remotes = new Map<string, string | null>();
const forgetRemotes = (slug: string) => {
  for (const k of [...remotes.keys()])
    if (k.startsWith(`${slug}/`)) remotes.delete(k);
};

async function remoteOf(slug: string, name: string): Promise<string | null> {
  const key = `${slug}/${name}`;
  const cached = remotes.get(key);
  if (cached !== undefined) return cached;
  let value: string | null = null;
  try {
    const { stdout } = await run(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: workspaceRoot(name), timeout: 10_000 },
    );
    value = normalizeGitUri(stdout.trim());
  } catch {
    // Not a repository, no origin, or a remote spelling we refuse — all "no repo here".
    value = null;
  }
  remotes.set(key, value);
  return value;
}

/** The workspace already holding this repository, compared on NORMALIZED uris — see docs/workspaces.md. */
/**
 * Remove a workspace from this machine: the folder and everything under it, for good.
 *
 * There is no recycle bin for this one — the bin lives INSIDE a workspace (`_recycle_bin`), so a
 * workspace has nowhere of its own to fall into. What makes that acceptable is that a workspace
 * with an `origin` is re-cloneable and one without was only ever here; what makes it dangerous is
 * that the second kind is gone for good, which is why the caller asks first.
 *
 * `unload` is not optional on Windows: a handle open anywhere under the folder answers EPERM and
 * the delete half-succeeds — the same wall a person hits deleting it by hand. See docs/workspaces.md.
 */
export async function removeWorkspace(
  userEmail: string,
  workspace: string,
  unload?: (abs: string) => void | Promise<unknown>,
): Promise<void> {
  const root = workspaceRoot(workspace); // validates the name
  if (!existsSync(root)) throw new Error(`no such workspace: ${workspace}`);
  // Every module watch inside it first: `fs.watch` holds a directory, and on Windows that is an
  // EPERM half-way through a removal — the same reason `deleteProject` lets go (docs/moduleWatch.md).
  closeModuleWatchesUnder(root);
  await unload?.(root);
  rmSync(root, { recursive: true, force: true });
  // Its marker is beside it, not in it: a workspace made again under the name must not reopen a ghost.
  rmSync(activeMarkerOf(root), { force: true });
  const slug = slugify(userEmail);
  forgetRemotes(slug);
  forgetListing(slug);
}

export async function workspaceForRepo(
  userEmail: string,
  uri: string,
): Promise<string | null> {
  const want = normalizeGitUri(uri);
  const slug = slugify(userEmail);
  const dir = rootDir();
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if ((await remoteOf(slug, e.name)) === want) return e.name;
  }
  return null;
}

/** A free workspace name for this repository — its own, then `-2`, `-3`… */
export function workspaceNameFor(uri: string): string {
  const base = repoName(uri) || "repo";
  if (!existsSync(workspaceRoot(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!existsSync(workspaceRoot(candidate))) return candidate;
  }
  throw new Error(`no free workspace name for ${base}`);
}

// Every workspace folder under the user's root; Examples is already there, put by the service's startup (demos.ts).
export function listWorkspaces(_userEmail: string): WorkspaceSummary[] {
  const dir = rootDir();
  const out: WorkspaceSummary[] = [];
  for (const name of workspaceNames(dir)) {
    const abs = join(dir, name);
    const single = isProjectDir(abs);
    out.push({
      name,
      isSingleProject: single,
      projectCount: single ? 1 : projectDirsUnder(abs).length,
    });
  }
  return out;
}

/** The workspace folders under a user root, sorted — the one place the hidden ones are dropped, the BENCH's among them: it is opened by its address, never chosen from a list. */
export function workspaceNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          e.name !== BENCH_WORKSPACE,
      )
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return []; // no root yet, or unreadable — no workspaces rather than a throw
  }
}

/** Every workspace on this machine, with its projects and origin — what st0's home page draws (docs/workspaces.md). */
export async function listMachineWorkspaces(
  userEmail: string,
): Promise<AccountWorkspace[]> {
  const slug = slugify(userEmail);
  const hit = listings.get(slug);
  if (hit && Date.now() - hit.at < LISTING_RESCAN_MS) return hit.rows;
  const dir = rootDir();
  const names = workspaceNames(dir);
  // The origins first and on their own: a short name only identifies a workspace when no other answers to it.
  const origins = await Promise.all(names.map((n) => remoteOf(slug, n)));
  // `repoNameOfKey` and not `repoName`: these origins are already normalized keys (docs/workspaces.md).
  const shortNames = origins.map((o) => (o ? repoNameOfKey(o) || null : null));
  const times = new Map<string, number>();
  for (const n of shortNames) if (n) times.set(n, (times.get(n) ?? 0) + 1);

  const rows = names.map((name, i): AccountWorkspace => {
    const abs = join(dir, name);
    const single = isProjectDir(abs);
    const short = shortNames[i];
    return {
      name,
      origin: origins[i],
      repoName: short,
      uniqueName: short !== null && times.get(short) === 1,
      isSingleProject: single,
      projects: (single ? ["."] : projectDirsUnder(abs)).flatMap((path) => {
        // `.` names the workspace folder itself; either way the NAME decides, the one rule both ends use.
        const app = projectApp(path === "." ? name : path.split("/").pop()!);
        return app ? [{ path, app }] : [];
      }),
    };
  });
  listings.set(slug, { at: Date.now(), rows });
  return rows;
}

/** The window under the listing above, so a polling home page does not walk every tree per tick (docs/workspaces.md). */
const LISTING_RESCAN_MS = 5_000;
const listings = new Map<string, { at: number; rows: AccountWorkspace[] }>();
// Both listings, since the second is built on the first — see docs/workspaces.md.
export const forgetListing = (slug: string) => {
  listings.delete(slug);
  surfaced.delete(slug);
};

/** Every project that DECLARES a surface, flat — what st0's `/external` page draws (docs/workspaces.md). */
export async function listSurfacedProjects(
  userEmail: string,
): Promise<SurfacedProject[]> {
  const slug = slugify(userEmail);
  const hit = surfaced.get(slug);
  if (hit && Date.now() - hit.at < LISTING_RESCAN_MS) return hit.rows;
  const dir = rootDir();
  const workspaces = await listMachineWorkspaces(userEmail);
  const rows: SurfacedProject[] = [];
  for (const w of workspaces) {
    const abs = join(dir, w.name);
    const active = activeOf(abs);
    for (const p of w.projects) {
      const at = p.path === "." ? abs : join(abs, p.path);
      // Diagnostics are dropped on purpose: the place that says WHY a surface will not parse is the editor.
      const { surfaces } = projectSurfaces(at);
      if (!surfaces.length) continue;
      rows.push({
        workspace: w.name,
        repoName: w.repoName,
        uniqueName: w.uniqueName,
        path: p.path,
        app: p.app,
        active: active !== null && active === resolve(at),
        surfaces: surfaces.map((s) => ({ id: s.id, type: s.surface.type })),
      });
    }
  }
  surfaced.set(slug, { at: Date.now(), rows });
  return rows;
}

const surfaced = new Map<string, { at: number; rows: SurfacedProject[] }>();

/** The workspace's open project, absolute, straight off the marker file; null when nothing is open. */
const activeOf = (workspaceRootDir: string): string | null =>
  readActiveMarker(workspaceRootDir);
