// workspaceSync.ts — where each workspace stands against its repository, for the home page's rows:
// uncommitted paths, commits not pushed, commits not pulled. The local counts are read on every
// call; the FETCH that makes "not pulled" true is a network call, so it runs at most once a
// minute per workspace and never longer than FETCH_MS. See docs/workspaces.md § Sync state.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceSync } from "@studio/web-protocol";
import { rootDir, slugify } from "./slug.ts";
import { gitEnvFor, workspaceNames } from "./workspaces.ts";

const run = promisify(execFile);

const QUICK_MS = 10_000;
const FETCH_MS = 20_000;
/** How old a fetch may be before the next poll pays for another. */
const FETCH_EVERY_MS = 60_000;

/** The last fetch per `<slug>/<workspace>`: when, how it went, and the one in flight. */
const fetches = new Map<
  string,
  { at: number; error?: string; running?: Promise<void> }
>();

/** Fetch unless a recent one stands; a fetch already running is joined, never doubled. */
async function fetchIfStale(
  key: string,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const last = fetches.get(key);
  if (last?.running) await last.running;
  else if (!last || Date.now() - last.at >= FETCH_EVERY_MS) {
    const entry: { at: number; error?: string; running?: Promise<void> } = {
      at: Date.now(),
    };
    entry.running = run("git", ["fetch", "--quiet", "--no-tags"], {
      cwd: root,
      env,
      timeout: FETCH_MS,
    })
      .then(() => undefined)
      .catch((e: { stderr?: string; message?: string }) => {
        entry.error = (e.stderr || e.message || "git fetch failed").trim();
      })
      .finally(() => {
        entry.running = undefined;
        entry.at = Date.now();
      });
    fetches.set(key, entry);
    await entry.running;
  }
  return fetches.get(key)?.error;
}

/** One workspace's state; a folder that is not a repository is simply clean, with no upstream. */
async function syncOf(userEmail: string, name: string): Promise<WorkspaceSync> {
  const root = join(rootDir(), name);
  const none: WorkspaceSync = { name, dirty: 0, ahead: null, behind: null };
  if (!existsSync(join(root, ".git"))) return none;
  const env = gitEnvFor(userEmail);
  const git = async (args: string[]) =>
    (await run("git", args, { cwd: root, env, timeout: QUICK_MS })).stdout;
  try {
    const status = await git(["status", "--porcelain", "-z"]);
    // `-z` ends every entry with a NUL; a rename carries its old path as a second one.
    const dirty = status
      .split("\0")
      .filter((e) => /^[ MADRCU?!]{2} /.test(e)).length;
    const upstream = await git(["rev-parse", "--abbrev-ref", "@{u}"]).catch(
      () => "",
    );
    if (!upstream.trim()) return { ...none, dirty };
    const fetchError = await fetchIfStale(
      `${slugify(userEmail)}/${name}`,
      root,
      env,
    );
    const [ahead, behind] = (
      await git(["rev-list", "--left-right", "--count", "HEAD...@{u}"])
    )
      .trim()
      .split(/\s+/)
      .map((n) => Number(n) || 0);
    return { name, dirty, ahead, behind, ...(fetchError && { fetchError }) };
  } catch {
    // An unborn branch or a broken checkout: nothing to report rather than a row that errors.
    return none;
  }
}

/** Every workspace on this machine, in parallel — each one's fetch is bounded, so the slowest host sets the wait. */
export async function workspaceSync(
  userEmail: string,
): Promise<WorkspaceSync[]> {
  return Promise.all(
    workspaceNames(rootDir()).map((name) => syncOf(userEmail, name)),
  );
}
