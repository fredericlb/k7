// workspaces.ts — the live set of Workspace instances, one per (userSlug, workspace),
// plus listing a user's workspaces for the picker.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceSummary } from "@lanes/web-shared";
import { EXAMPLES_WORKSPACE, mirrorDemos } from "./demos.ts";
import { slugify, userRoot, workspaceRoot } from "./slug.ts";
import { publicKey, sshCommand } from "./sshKeys.ts";
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

/** Create a workspace folder. Returns false if it was already there. */
export function createWorkspace(userEmail: string, workspace: string): boolean {
  const root = workspaceRoot(slugify(userEmail), workspace);
  if (existsSync(root)) return false;
  mkdirSync(root, { recursive: true });
  return true;
}

// SSH ONLY: the per-user key carries the privilege, and an https URI would sidestep it and hang on a prompt.
// Both shapes anchor on an alphanumeric first char, so a URI can never reach git looking like an option.
const SCP_URI = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[A-Za-z0-9._~/-]+$/; // git@host:path
const SSH_URL =
  /^ssh:\/\/([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+(:\d+)?\/[A-Za-z0-9._~/-]+$/;

export function assertSshGitUri(uri: string): void {
  if (!SCP_URI.test(uri) && !SSH_URL.test(uri))
    throw new Error(
      `not an SSH git URI: ${uri} — use git@host:path or ssh://host/path`,
    );
}

/**
 * Clone an SSH git repository as a new workspace. The other place (besides
 * `createWorkspace`) a workspace comes into existence on request.
 * Throws with git's stderr on failure — that text ("Permission denied (publickey)",
 * "Host key verification failed") is exactly what the user needs to see.
 */
export async function cloneWorkspace(
  userEmail: string,
  workspace: string,
  uri: string,
): Promise<void> {
  assertSshGitUri(uri);
  const slug = slugify(userEmail);
  const root = workspaceRoot(slug, workspace); // validates the name
  if (existsSync(root))
    throw new Error(`workspace already exists: ${workspace}`);
  if (!publicKey(userEmail))
    throw new Error(
      "no SSH key yet — generate one on the SSH key page and add it to your git host first",
    );
  mkdirSync(userRoot(slug), { recursive: true });
  try {
    await run("git", ["clone", "--", uri, root], {
      env: {
        ...process.env,
        GIT_SSH_COMMAND: sshCommand(userEmail),
        GIT_TERMINAL_PROMPT: "0", // fail rather than prompt (no terminal to answer)
        // Load-bearing, not hygiene: a personal `insteadOf` rewrite turns the SSH URI back to https, privilege and all.
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    // `root` didn't exist above, so whatever is there is our debris — a half-clone must not survive in the picker.
    rmSync(root, { recursive: true, force: true });
    const err = e as { stderr?: string; message: string };
    throw new Error((err.stderr || err.message).trim());
  }
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
