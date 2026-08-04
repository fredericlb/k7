// workspaces.ts — the live set of Workspace instances, one per (userSlug, workspace),
// plus listing a user's workspaces for the picker.

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  assertSshGitUri,
  normalizeGitUri,
  repoName,
} from "@studio/git-repos/uri";
import type { WorkspaceSummary } from "@studio/web-protocol";
import { EXAMPLES_WORKSPACE, mirrorDemos } from "./demos.ts";
import { slugify, userRoot, workspaceRoot } from "./slug.ts";
import { ensureKey, sshCommand } from "./sshKeys.ts";
import { isProjectDir, Workspace } from "./workspace.ts";

const run = promisify(execFile);

// Memoized so a workspace's caches (compiled doc, waveforms) persist across requests.
const live = new Map<string, Workspace>();

/** Thrown when a request names a workspace that isn't there. Carried as a type so the
 * HTTP layer can answer 404 rather than lumping it in with a malformed name (400). */
export class UnknownWorkspaceError extends Error {
  constructor(name: string) {
    super(`unknown workspace: ${name}`);
    this.name = "UnknownWorkspaceError";
  }
}

/**
 * The Workspace for an EXISTING folder. Opening does NOT create.
 *
 * It used to mkdir on first touch, which made any request that merely named a workspace
 * conjure one: a browser tab still retrying with a remembered name would silently
 * recreate a workspace you had just deleted, empty. Creation now happens only in
 * `createWorkspace` (from `POST /workspaces`), `cloneWorkspace` (from
 * `POST /workspaces/clone`) and the one-off Examples bootstrap below, so what is on
 * disk changes because someone asked for it.
 */
export function getWorkspace(userEmail: string, workspace: string): Workspace {
  const slug = slugify(userEmail);
  const key = `${slug}/${workspace}`;
  // workspaceRoot() throws on a traversing/empty name; that stays a 400.
  const root = workspaceRoot(slug, workspace);
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

/** Every workspace currently open, for the machine-wide jobs that have no request to hang off —
 *  the médiathèque puller, which needs both the songs in use and their compiled-doc caches. */
export function liveWorkspaces(): Workspace[] {
  return [...live.values()];
}

/** Create a workspace folder. Returns false if it was already there. */
export function createWorkspace(userEmail: string, workspace: string): boolean {
  const root = workspaceRoot(slugify(userEmail), workspace);
  if (existsSync(root)) return false;
  mkdirSync(root, { recursive: true });
  return true;
}

// Re-exported: the rule moved to @studio/git-repos when st0 started needing it too, and
// callers here should not have to know that.
export { assertSshGitUri };

function gitEnvFor(userEmail: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_SSH_COMMAND: sshCommand(userEmail),
    GIT_TERMINAL_PROMPT: "0", // fail rather than prompt (no terminal to answer)
    // Load-bearing, not hygiene: a personal `insteadOf` rewrite turns the SSH URI back to https, privilege and all.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/** What a clone reports as it runs — enough to draw a bar and to say what went wrong. */
export interface CloneProgress {
  phase: string;
  percent: number | null;
  line: string;
}

/**
 * Clone an SSH git repository as a new workspace. The other place (besides
 * `createWorkspace`) a workspace comes into existence on request.
 * Throws with git's stderr on failure — that text ("Permission denied (publickey)",
 * "Host key verification failed") is exactly what the user needs to see.
 *
 * `onProgress` is what makes the wait visible; see docs/cloneJobs.md.
 */
export async function cloneWorkspace(
  userEmail: string,
  workspace: string,
  uri: string,
  onProgress?: (p: CloneProgress) => void,
): Promise<void> {
  assertSshGitUri(uri);
  const slug = slugify(userEmail);
  const root = workspaceRoot(slug, workspace); // validates the name
  if (existsSync(root))
    throw new Error(`workspace already exists: ${workspace}`);
  // Throws NoKeyError with a sentence naming the fix; st0 owns the key, this machine holds a copy.
  await ensureKey(userEmail);
  mkdirSync(userRoot(slug), { recursive: true });
  try {
    await gitClone(uri, root, gitEnvFor(userEmail), onProgress);
  } catch (e) {
    // `root` didn't exist above, so whatever is there is our debris — a half-clone must not survive in the picker.
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
  forgetRemotes(slug);
}

/** `--progress` because git only writes counters when it thinks it has a terminal. */
function gitClone(
  uri: string,
  root: string,
  env: NodeJS.ProcessEnv,
  onProgress?: (p: CloneProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", "--progress", "--", uri, root], {
      env,
    });
    let tail = "";
    const stderr: string[] = [];
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
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

function parse(line: string): CloneProgress {
  const pct = /(\d+)%/.exec(line);
  const colon = line.indexOf(":");
  return {
    phase: colon > 0 ? line.slice(0, colon).trim() : line,
    percent: pct ? Number(pct[1]) : null,
    line,
  };
}

// A workspace's remote, by name. Filled lazily and dropped whole when a clone adds one —
// `git config` per workspace on every lookup would be a subprocess per poll.
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
      { cwd: workspaceRoot(slug, name), timeout: 10_000 },
    );
    value = normalizeGitUri(stdout.trim());
  } catch {
    // Not a repository, no origin, or a remote spelling we refuse — all "no repo here".
    value = null;
  }
  remotes.set(key, value);
  return value;
}

/**
 * The workspace already holding this repository, or null.
 *
 * This is what stops l8 re-cloning something that is already on disk, and it compares
 * NORMALIZED uris because the two sides learn the address by different routes: st0 has what
 * was pasted, this has whatever `git` wrote into `remote.origin.url`.
 */
export async function workspaceForRepo(
  userEmail: string,
  uri: string,
): Promise<string | null> {
  const want = normalizeGitUri(uri);
  const slug = slugify(userEmail);
  const dir = userRoot(slug);
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if ((await remoteOf(slug, e.name)) === want) return e.name;
  }
  return null;
}

/** A free workspace name for this repository — its own, then `-2`, `-3`… */
export function workspaceNameFor(userEmail: string, uri: string): string {
  const slug = slugify(userEmail);
  const base = repoName(uri) || "repo";
  if (!existsSync(workspaceRoot(slug, base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!existsSync(workspaceRoot(slug, candidate))) return candidate;
  }
  throw new Error(`no free workspace name for ${base}`);
}

// Every workspace folder under the user's root; a first-seen user gets Examples, the one never asked for.
export function listWorkspaces(userEmail: string): WorkspaceSummary[] {
  const dir = userRoot(slugify(userEmail));
  if (!existsSync(dir)) {
    // Keyed on the USER ROOT being absent, so it is a once-per-user bootstrap and not the open path conjuring folders.
    mkdirSync(dir, { recursive: true });
    const examples = join(dir, EXAMPLES_WORKSPACE);
    const seeded = mirrorDemos(examples);
    console.log(
      `   new user ${slugify(userEmail)}: ${EXAMPLES_WORKSPACE} with ${seeded.join(", ") || "no demos found"}`,
    );
  }
  const out: WorkspaceSummary[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const abs = join(dir, e.name);
    const single = isProjectDir(abs);
    out.push({
      name: e.name,
      isSingleProject: single,
      projectCount: single ? 1 : countProjects(abs),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Shallow count of immediate project subfolders (a container workspace holds several).
function countProjects(dir: string): number {
  let n = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory() && isProjectDir(join(dir, e.name))) n++;
  } catch {
    /* unreadable — report 0 */
  }
  return n;
}
