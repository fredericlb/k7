// compactWorkspace.ts — shrink a workspace's repository to what its working tree uses today: the
// recycle bin emptied, the history replaced by ONE commit, every other ref dropped, the objects
// pruned, and the result force-pushed when there is an origin. The working tree is never touched
// (the bin aside), which is what makes it safe to run on a project the engine is playing.
// The trap: this rewrites a published branch — see docs/workspaces.md § Compacting.

import { execFile } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CompactWorkspaceReply } from "@studio/web-protocol";
import { lfsAvailable } from "./gitLfs.ts";
import { slugify, workspaceRoot } from "./slug.ts";
import { forgetListing, gitEnvFor } from "./workspaces.ts";

const run = promisify(execFile);

const RECYCLE_DIR = "_recycle_bin";
/** The branch the new history is built on before it takes the current branch's name. */
const TEMP_BRANCH = "studio-compact";
const QUICK_MS = 30_000;
const PUSH_MS = 300_000;

/** Total size of a directory tree, 0 when it is not there. */
function sizeOf(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of readdirSync(path)) total += sizeOf(join(path, e));
  return total;
}

/** git's stderr, which is the message worth showing — `execFile` puts ours in `message`. */
function gitSaid(e: unknown): string {
  const err = e as { stderr?: string; message?: string };
  return (err.stderr || err.message || "git failed").trim();
}

/** Compact one workspace of this account — refuses rather than guesses on any unusual git state. */
export async function compactWorkspace(
  userEmail: string,
  workspace: string,
): Promise<CompactWorkspaceReply> {
  const root = workspaceRoot(workspace); // validates the name
  if (!existsSync(root)) throw new Error(`no such workspace: ${workspace}`);
  const dotGit = join(root, ".git");
  const bin = join(root, RECYCLE_DIR);
  const before = sizeOf(dotGit) + sizeOf(bin);
  const env = gitEnvFor(userEmail);
  const git = async (args: string[], timeout = QUICK_MS): Promise<string> =>
    (
      await run("git", args, { cwd: root, env, timeout, maxBuffer: 64 << 20 })
    ).stdout.trim();
  const tryGit = (args: string[], timeout?: number) =>
    git(args, timeout).catch(() => "");

  // Everything that would make "the current branch" ambiguous is refused BEFORE anything is deleted.
  if (!existsSync(dotGit))
    throw new Error(`${workspace} is not a git repository`);
  for (const busy of ["MERGE_HEAD", "rebase-merge", "rebase-apply"])
    if (existsSync(join(dotGit, busy)))
      throw new Error(`${workspace} is in the middle of a merge or rebase`);
  const branch = await tryGit(["symbolic-ref", "--short", "HEAD"]);
  if (!branch) throw new Error(`${workspace} is not on a branch`);
  if (await tryGit(["config", "--get", `branch.${branch}.studioParent`]))
    throw new Error(
      `${workspace} is on the alternative '${branch}' — apply or cancel it first`,
    );
  const hasHead = Boolean(
    await tryGit(["rev-parse", "--verify", "-q", "HEAD"]),
  );
  const origin = await tryGit(["config", "--get", "remote.origin.url"]);

  rmSync(bin, { recursive: true, force: true });

  if (hasHead) {
    // The new root commit holds the working tree as .gitignore sees it, uncommitted edits included.
    await git(["checkout", "-q", "--orphan", TEMP_BRANCH]);
    try {
      await git(["read-tree", "--empty"]);
      await git(["add", "-A"], PUSH_MS);
      await git(
        ["commit", "-q", "--allow-empty", "-m", `compact ${workspace}`],
        PUSH_MS,
      );
    } catch (e) {
      // Back onto the old branch with its index; the working tree was never touched.
      await tryGit(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
      await tryGit(["reset", "-q"]);
      await tryGit(["branch", "-D", TEMP_BRANCH]);
      throw new Error(gitSaid(e));
    }
    await git(["branch", "-M", branch]);

    // Every other ref still reaches the old history: branches, tags, the stash, remote-tracking.
    const refs = (await git(["for-each-ref", "--format=%(refname)"])).split(
      "\n",
    );
    for (const ref of refs.filter(Boolean)) {
      if (ref === `refs/heads/${branch}`) continue;
      // `--no-deref`: `refs/remotes/origin/HEAD` is a symref, and following it deletes its target twice.
      await git(["update-ref", "--no-deref", "-d", ref]);
      if (ref.startsWith("refs/heads/"))
        await tryGit([
          "config",
          "--remove-section",
          `branch.${ref.slice("refs/heads/".length)}`,
        ]);
    }
    await git(["reflog", "expire", "--expire=now", "--all"]);
    await git(["gc", "-q", "--prune=now"], PUSH_MS);
    if (await lfsAvailable()) await tryGit(["lfs", "prune"], PUSH_MS);
  }

  const outcome: CompactWorkspaceReply = {
    freed: Math.max(0, before - sizeOf(dotGit) - sizeOf(bin)),
    pushed: false,
  };
  if (hasHead && origin) {
    try {
      await git(["push", "-q", "--force", "-u", "origin", branch], PUSH_MS);
      outcome.pushed = true;
    } catch (e) {
      outcome.pushError = gitSaid(e);
    }
  }
  forgetListing(slugify(userEmail));
  return outcome;
}
