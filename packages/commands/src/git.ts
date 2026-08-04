// git.ts — the version-control commands (commit + push, pull, status for the share
// badge), all acting on the WHOLE repo the working dir belongs to: a workspace IS a
// cloned repo. `gitEnv` is the host's transport config merged over the process env — the
// web host pins GIT_SSH_COMMAND to the per-user deploy key, the CLI passes nothing.

import { execFileSync } from "node:child_process";

// Extra env for the git process, merged over process.env: the web fills GIT_SSH_COMMAND and GIT_TERMINAL_PROMPT.
export type GitEnv = Record<string, string> | undefined;

// Run git in `dir` and return stdout, throwing git's own stderr. `timeoutMs` bounds a network call, so a hung
// connection can't wedge the request — git is killed and this throws.
function git(
  dir: string,
  args: string[],
  gitEnv?: GitEnv,
  timeoutMs?: number,
): string {
  try {
    return execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // undefined inherits process.env; a map overrides only the keys it names.
      env: gitEnv ? { ...process.env, ...gitEnv } : undefined,
      timeout: timeoutMs,
    }).trim();
  } catch (e: any) {
    if (e?.code === "ENOENT")
      throw new Error(
        "the 'git' CLI is required — install it from https://git-scm.com",
      );
    const msg = (e.stderr?.toString?.() as string) || e.message;
    throw new Error(String(msg).trim());
  }
}

export interface CommitOutcome {
  nothingToCommit: boolean; // the project directory had no changes to stage
  sha?: string; // short hash of the new commit
  changed?: number; // number of files in the commit
  pushed: boolean;
  pushError?: string; // push failed after a successful commit (offline, no upstream…)
}

// Stage everything, commit and push. `dir` is anywhere inside the repo, and the commit covers the WHOLE tree.
export function commitAndPush(
  dir: string,
  message: string,
  gitEnv?: GitEnv,
): CommitOutcome {
  // Stage everything in the repo — additions, edits, and deletions across every path.
  git(dir, ["add", "-A"], gitEnv);
  // Anything changed? An empty porcelain listing is a clean tree, which is not an error — just nothing to commit.
  const status = git(dir, ["status", "--porcelain"], gitEnv);
  if (!status) return { nothingToCommit: true, pushed: false };
  const changed = status.split("\n").filter(Boolean).length;
  git(dir, ["commit", "-m", message], gitEnv);
  const sha = git(dir, ["rev-parse", "--short", "HEAD"], gitEnv);
  // Push last: it can fail where a commit can't, and that must not pretend the landed commit didn't happen.
  try {
    git(dir, ["push"], gitEnv);
    return { nothingToCommit: false, sha, changed, pushed: true };
  } catch (e) {
    return {
      nothingToCommit: false,
      sha,
      changed,
      pushed: false,
      pushError: (e as Error).message,
    };
  }
}

export interface PullOutcome {
  upToDate: boolean; // the local branch already had every remote commit
  summary: string; // git's own one-line summary of what moved (for the log)
}

// `--ff-only` on purpose: there is no terminal to resolve a merge and nowhere in the web UI to fix conflict
// markers, so a diverged branch (or a dirty file in the way) fails cleanly with git's message.
export function pull(dir: string, gitEnv?: GitEnv): PullOutcome {
  const out = git(dir, ["pull", "--ff-only"], gitEnv, 60_000);
  const upToDate = /already up to date/i.test(out);
  // git prints a multi-line report; the last non-empty line is its summary. Keep it short for the command log.
  const summary =
    out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? "pulled";
  return { upToDate, summary };
}

export interface GitStatus {
  tracked: boolean; // a git repo whose current branch has an upstream (else: no badge)
  ahead: number; // local commits the remote doesn't have
  behind: number; // remote commits not yet pulled
  // Behind, but also advanced locally: `pull --ff-only` can't run, so the badge flags it instead of a count.
  conflicted: boolean;
}

// Where the repo stands vs upstream, for the badge — polled, not a command. Fetches first, best-effort, and
// reports tracked:false when there is no repo or no upstream to compare against.
export function gitStatus(dir: string, gitEnv?: GitEnv): GitStatus {
  const none: GitStatus = {
    tracked: false,
    ahead: 0,
    behind: 0,
    conflicted: false,
  };
  try {
    git(dir, ["rev-parse", "--is-inside-work-tree"], gitEnv);
    git(dir, ["rev-parse", "--abbrev-ref", "@{u}"], gitEnv); // throws if no upstream
  } catch {
    return none;
  }
  // Refresh the remote-tracking ref, best-effort and bounded: a slow remote must not wedge the poll.
  try {
    git(dir, ["fetch", "--quiet"], gitEnv, 30_000);
  } catch {
    /* keep last-known counts */
  }
  const count = (range: string): number =>
    Number(git(dir, ["rev-list", "--count", range], gitEnv)) || 0;
  const behind = count("HEAD..@{u}");
  const ahead = count("@{u}..HEAD");
  return { tracked: true, ahead, behind, conflicted: behind > 0 && ahead > 0 };
}

// --- alternatives -------------------------------------------------------------
//
// An "alternative" is a git branch you try a direction on, with the branch you left
// remembered so `apply` and `cancel` know where to go back to. Git has no notion of a
// branch's parent, so it is written to `branch.<name>.studioParent` — the same
// per-branch config space `branch.<name>.merge` lives in, so it travels with the repo's
// config and is invisible to anything that doesn't look for it.
//
// The vocabulary is deliberately not git's: you are not "branching", you are trying
// another version of the song and either keeping it or dropping it.

const PARENT_KEY = (branch: string) => `branch.${branch}.studioParent`;

/** The branch checked out in `dir`, or "" when detached / not a repo. */
export function currentBranch(dir: string, gitEnv?: GitEnv): string {
  try {
    const b = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"], gitEnv);
    return b === "HEAD" ? "" : b;
  } catch {
    return "";
  }
}

/** Where `branch` was started from, or "" when it isn't an alternative. */
export function parentOf(dir: string, branch: string, gitEnv?: GitEnv): string {
  try {
    return git(dir, ["config", "--get", PARENT_KEY(branch)], gitEnv);
  } catch {
    return ""; // `config --get` exits 1 when the key is absent
  }
}

export interface Alternatives {
  current: string;
  parent: string; // "" when the current branch is not an alternative
  branches: { name: string; parent: string; current: boolean }[];
}

/** Every local branch, with each one's parent — what the header dropdown lists. */
export function alternatives(dir: string, gitEnv?: GitEnv): Alternatives {
  const current = currentBranch(dir, gitEnv);
  if (!current) return { current: "", parent: "", branches: [] };
  const names = git(
    dir,
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    gitEnv,
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    current,
    parent: parentOf(dir, current, gitEnv),
    branches: names.map((name) => ({
      name,
      parent: parentOf(dir, name, gitEnv),
      current: name === current,
    })),
  };
}

/** Anything staged or unstaged in the whole repo. */
export function isDirty(dir: string, gitEnv?: GitEnv): boolean {
  try {
    return git(dir, ["status", "--porcelain"], gitEnv).length > 0;
  } catch {
    return false;
  }
}

/** Commit everything under an autogenerated name — what `switch` does with work in
 *  progress. Named, not stashed: a stash is invisible from the branch you left it on,
 *  and the point of switching is to come back to find your work where you put it. */
export function commitWip(dir: string, gitEnv?: GitEnv): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const msg = `wip ${stamp}`;
  git(dir, ["add", "-A"], gitEnv);
  git(dir, ["commit", "-m", msg], gitEnv);
  return msg;
}

/** Start an alternative from the current branch and switch to it. */
export function newAlternative(
  dir: string,
  name: string,
  gitEnv?: GitEnv,
): string {
  const from = currentBranch(dir, gitEnv);
  if (!from)
    throw new Error(
      "not on a branch — l8 can't tell where to come back to",
    );
  git(dir, ["switch", "-c", name], gitEnv);
  git(dir, ["config", PARENT_KEY(name), from], gitEnv);
  return from;
}

/** Merge the current alternative back into the branch it came from, and land there. The
 *  alternative is LEFT in place: deleting it would throw away the history of a direction
 *  you might want to read again, and it costs nothing to keep. */
export function applyAlternative(
  dir: string,
  gitEnv?: GitEnv,
): { alt: string; parent: string; wip?: string } {
  const alt = currentBranch(dir, gitEnv);
  const parent = parentOf(dir, alt, gitEnv);
  if (!parent)
    throw new Error(`'${alt}' is not an alternative — nothing to apply it to`);
  // Work in progress is COMMITTED, not refused — the same thing `switch` does, for the same reason: the last
  // edits are usually the ones you are applying, and "commit them first" sends you away to run a second command
  // that would only produce this commit anyway. It lands on the alternative, before the switch, so the merge
  // below carries it into the parent.
  const wip = isDirty(dir, gitEnv) ? commitWip(dir, gitEnv) : undefined;
  git(dir, ["switch", parent], gitEnv);
  try {
    git(
      dir,
      ["merge", "--no-ff", alt, "-m", `apply alternative ${alt}`],
      gitEnv,
    );
  } catch (e) {
    // Land back where the user was rather than leaving them on a half-merged parent.
    try {
      git(dir, ["merge", "--abort"], gitEnv);
      git(dir, ["switch", alt], gitEnv);
    } catch {
      /* the abort itself failed — the message below is the honest thing to report */
    }
    throw e;
  }
  return { alt, parent, wip };
}

/** Throw away what the current alternative changed and return to its parent. Destructive
 *  by design — `cancel` is the word for it — so it refuses when there is no parent, and
 *  the branch is left behind rather than deleted. */
export function cancelAlternative(
  dir: string,
  gitEnv?: GitEnv,
): { alt: string; parent: string } {
  const alt = currentBranch(dir, gitEnv);
  const parent = parentOf(dir, alt, gitEnv);
  if (!parent)
    throw new Error(
      `'${alt}' is not an alternative — nothing to cancel back to`,
    );
  git(dir, ["reset", "--hard"], gitEnv); // drop tracked edits
  git(dir, ["clean", "-fd"], gitEnv); // …and files git never knew about
  git(dir, ["switch", parent], gitEnv);
  return { alt, parent };
}

/** Move to another alternative, committing work in progress under a generated name so
 *  nothing is lost and nothing has to be named in a hurry. */
export function switchAlternative(
  dir: string,
  name: string,
  gitEnv?: GitEnv,
): { from: string; wip?: string } {
  const from = currentBranch(dir, gitEnv);
  const wip = isDirty(dir, gitEnv) ? commitWip(dir, gitEnv) : undefined;
  git(dir, ["switch", name], gitEnv);
  return { from, wip };
}
