// libraries.ts — the LIBRARIES as this account's service sees them: read-only, from the file hub's
// one clone of each (`$STUDIO_LIBRARIES_HOME`), which the hub clones and pulls. This service asks
// it to (`$STUDIO_HUB_URL`), and keeps only the git helpers the bench's clone and the retirement
// of a workspace's old `_libraries` need. Rationale: packages/song/docs/sharedFolders.md,
// mechanics: docs/libraries.md.

import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { LIBRARIES_DIR } from "@studio/song/sharedFolders";
import { HUB_SECRET_HEADER, type LibraryNote } from "@studio/web-protocol";
import { sshCommand } from "./sshKeys.ts";

const run = promisify(execFile);

/** Bounded like every other git call here: a hung fetch must not hold a workspace open. */
export const TIMEOUT_MS = 120_000;

export function envFor(userEmail: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_SSH_COMMAND: sshCommand(userEmail),
    GIT_TERMINAL_PROMPT: "0",
    // Load-bearing: a personal `insteadOf` rewrite turns the SSH URI back to https, privilege and all.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

export const git = (root: string, args: string[], env: NodeJS.ProcessEnv) =>
  run("git", ["-C", root, ...args], { env, timeout: TIMEOUT_MS });

/** The author is the person editing, through `-c`: a machine must not write its identity into a checkout. */
export const author = (userEmail: string): string[] => [
  "-c",
  "user.name=studio",
  "-c",
  `user.email=${userEmail || "studio@localhost"}`,
];

/** Does the folder hold anything? A clone that never finished is removed, so empty means absent. */
export const isPopulated = (dir: string): boolean => {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

/** What a checkout holds that its remote does not, counted: files changed, and commits not pushed. */
export async function unpublishedCounts(
  at: string,
  env: NodeJS.ProcessEnv,
): Promise<{ changed: number; ahead: number }> {
  // `git -C` climbs to whatever repository CONTAINS a folder that is not one itself — that one's status says nothing here.
  const { stdout: top } = await git(at, ["rev-parse", "--show-toplevel"], env);
  if (realpathSync(top.trim()) !== realpathSync(at))
    throw new Error(`${at} is not a git checkout of its own`);
  const { stdout: status } = await git(at, ["status", "--porcelain"], env);
  const changed = status.split("\n").filter((l) => l.trim()).length;
  let ahead = 0;
  try {
    // `--not --remotes`: a checkout with no upstream yet still has its unpushed commits counted.
    const { stdout } = await git(
      at,
      ["rev-list", "--count", "HEAD", "--not", "--remotes"],
      env,
    );
    ahead = Number(stdout.trim()) || 0;
  } catch {
    /* unborn HEAD — nothing committed, so nothing unpushed */
  }
  return { changed, ahead };
}

/** The same, said: empty when nothing would be lost. */
async function unpublished(
  at: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const { changed, ahead } = await unpublishedCounts(at, env);
  const out: string[] = [];
  if (changed) out.push(`${changed} file(s) changed and not published`);
  if (ahead) out.push(`${ahead} commit(s) not pushed`);
  return out;
}

/** Give a brand-new library repository a first commit, so it has a branch to fetch — see docs/libraries.md. */
export async function initIfEmpty(
  at: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await git(at, ["rev-parse", "--verify", "HEAD"], env);
    return;
  } catch {
    /* unborn HEAD — the one case this exists for */
  }
  await git(
    at,
    [
      ...author(""),
      "commit",
      "--allow-empty",
      "-m",
      "les bibliotheques : premier commit",
    ],
    env,
  );
  await git(at, ["push", "-u", "origin", "HEAD"], env).catch((e: Error) =>
    console.warn(
      `[libraries] committed in ${at} but could not push: ${e.message}`,
    ),
  );
}

// ── the hub, which holds the clones ──────────────────────────────────────────

/** Ask the hub to bring the clones to their remote — all, or `name`; it answers once any missing clone is there. */
export async function askHubSync(
  opts: { name?: string; force?: boolean } = {},
): Promise<LibraryNote[]> {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: set by the file hub, never under turbo
  const url = process.env.STUDIO_HUB_URL;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: set by the file hub, never under turbo
  const secret = process.env.STUDIO_HUB_SECRET ?? "";
  if (!url) return []; // no hub: the clones are whatever the folder holds
  const r = await fetch(`${url}/libraries/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HUB_SECRET_HEADER]: secret,
    },
    body: JSON.stringify(opts),
  });
  if (!r.ok)
    throw new Error(`the hub could not sync the libraries (${r.status})`);
  return ((await r.json()) as { notes?: LibraryNote[] }).notes ?? [];
}

/** What an OPEN does: the libraries at their latest, waited for only when one is not cloned yet — the hub decides. */
export async function refreshLibraries(): Promise<void> {
  await askHubSync().catch((e: Error) =>
    console.warn(`[libraries] ${e.message}`),
  );
}

// ── what workspaces held before: `_libraries` as a submodule or a clone ──────

/** Is `root` a git working copy? A workspace made by `createWorkspace` is not one. */
async function isRepo(root: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"], env);
    return true;
  } catch {
    return false;
  }
}

/** Does `.gitmodules` still declare `_libraries`? */
async function declaresSubmodule(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  try {
    await git(
      root,
      ["config", "--file", ".gitmodules", `submodule.${LIBRARIES_DIR}.url`],
      env,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Take the OLD per-workspace `_libraries` out of a workspace: the submodule is removed from its
 * repository in one path-limited commit (never pushed), a plain clone is deleted. Nothing is lost
 * doing it — a checkout holding unpublished work is left exactly where it is, and the answer says
 * what to do. It resolves nothing any more either way: `@<name>/…` reads the hub's clones.
 * See docs/libraries.md.
 */
export async function retireWorkspaceLibraries(
  userEmail: string,
  root: string,
): Promise<{ retired: boolean; note: string } | null> {
  const at = join(root, LIBRARIES_DIR);
  const env = envFor(userEmail);
  const repo = await isRepo(root, env);
  const declared = repo && (await declaresSubmodule(root, env));
  if (!declared && !existsSync(at)) return null; // nothing to retire — the ordinary case

  if (isPopulated(at)) {
    // A folder git cannot read is KEPT: "cannot tell" is never "nothing to lose".
    const left = await unpublished(at, env).catch((e: Error) => [
      `contents git cannot account for (${e.message.split("\n")[0]})`,
    ]);
    if (left.length)
      return {
        retired: false,
        note: `${at} holds ${left.join(" and ")} — it is no longer read; publish them from it by hand, then reopen to remove it`,
      };
  }

  if (declared) {
    // `git rm` on a submodule removes its checkout AND its `.gitmodules` section, staged together.
    await git(
      root,
      ["rm", "-q", "-r", "--force", "--", LIBRARIES_DIR],
      env,
    ).catch(
      () => undefined, // declared but never checked out: no gitlink to remove, only the section
    );
    await git(
      root,
      [
        "config",
        "--file",
        ".gitmodules",
        "--remove-section",
        `submodule.${LIBRARIES_DIR}`,
      ],
      env,
    ).catch(() => undefined); // already removed by `git rm`
    // A `.gitmodules` left empty goes too; one naming other submodules keeps them.
    const gm = join(root, ".gitmodules");
    if (existsSync(gm)) {
      if (!readFileSync(gm, "utf8").trim())
        await git(root, ["rm", "-q", "--force", "--", ".gitmodules"], env);
      else await git(root, ["add", "--", ".gitmodules"], env);
    }
    const paths = [LIBRARIES_DIR, ".gitmodules"];
    const { stdout: absGitDir } = await git(
      root,
      ["rev-parse", "--absolute-git-dir"],
      env,
    );
    rmSync(join(absGitDir.trim(), "modules", LIBRARIES_DIR), {
      recursive: true,
      force: true,
    });
    const { stdout: staged } = await git(
      root,
      ["diff", "--cached", "--name-only", "--", ...paths],
      env,
    );
    if (staged.trim())
      await git(
        root,
        [
          ...author(userEmail),
          "commit",
          "-q",
          "-m",
          "libraries: no longer a submodule — the file service provides them",
          "--",
          ...paths,
        ],
        env,
      );
  }
  rmSync(at, { recursive: true, force: true });
  return {
    retired: true,
    note: declared
      ? "removed the libraries submodule (committed, not pushed)"
      : "removed the old libraries clone",
  };
}
