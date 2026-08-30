// libraries.ts — mount the account's library repository into a workspace, at `_libraries`.
// A git SUBMODULE where the workspace is a git repository, a plain clone where it is not.
// This is what `@st0/…` resolves against, and it is the ONLY source: nothing syncs modules from
// the médiathèque, and nothing seeds a catalogue into it either.
// Rationale: packages/song/docs/sharedFolders.md.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { promisify } from "node:util";
import { assertSshGitUri, normalizeGitUri } from "@studio/git-repos/uri";
import { LIBRARIES_DIR } from "@studio/song/sharedFolders";
import { studioHome } from "@studio/song/studioHome";
import { ensureKey, sshCommand } from "./sshKeys.ts";

const run = promisify(execFile);

/** Bounded like every other git call here: a hung fetch must not hold a workspace open. */
const TIMEOUT_MS = 120_000;

function envFor(userEmail: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_SSH_COMMAND: sshCommand(userEmail),
    GIT_TERMINAL_PROMPT: "0",
    // Load-bearing: a personal `insteadOf` rewrite turns the SSH URI back to https, privilege and all.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

const git = (root: string, args: string[], env: NodeJS.ProcessEnv) =>
  run("git", ["-C", root, ...args], { env, timeout: TIMEOUT_MS });

/** Is this folder a git working copy? A workspace made by `createWorkspace` is not one. */
async function isRepo(root: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"], env);
    return true;
  } catch {
    return false;
  }
}

/** What `.gitmodules` already says `_libraries` points at, or null when it says nothing. */
async function declaredUri(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const { stdout } = await git(
      root,
      ["config", "--file", ".gitmodules", `submodule.${LIBRARIES_DIR}.url`],
      env,
    );
    return stdout.trim() || null;
  } catch {
    return null; // no .gitmodules, or no such submodule — both are "not declared"
  }
}

/** Keep `_libraries` out of the PROJECT repository's `git add -A`, best effort — see docs/libraries.md. */
export async function excludeFromProjectRepo(
  root: string,
  env: NodeJS.ProcessEnv = envFor(""),
): Promise<void> {
  const line = `/${LIBRARIES_DIR}/`;
  try {
    // Asked for rather than assumed to be `<root>/.git`, which is a FILE in a worktree or a submodule.
    const { stdout } = await git(
      root,
      ["rev-parse", "--absolute-git-dir"],
      env,
    );
    const file = join(stdout.trim(), "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (current.split(/\r?\n/).includes(line)) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${current}${current && !current.endsWith("\n") ? "\n" : ""}# the account's library submodule — see packages/song/docs/sharedFolders.md\n${line}\n`,
      "utf8",
    );
  } catch {
    /* no git dir, or a read-only one — the mount is still correct */
  }
}

/** Stage `_libraries` as a submodule without committing; `--force` is not optional — see docs/libraries.md. */
export async function registerSubmodule(
  root: string,
  uri: string,
  env: NodeJS.ProcessEnv = envFor(""),
): Promise<void> {
  await git(
    root,
    ["submodule", "add", "--force", "--", uri, LIBRARIES_DIR],
    env,
  );
}

/** Does the mount hold anything? An uninitialised submodule is an empty folder. */
const isPopulated = (dir: string): boolean => {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

/** A library already mounted here pointing elsewhere — never fixed automatically, see docs/libraries.md. */
export class LibrariesMovedError extends Error {}

/** Give a brand-new library repository the one thing a gitlink needs: a commit — see docs/libraries.md. */
export async function initIfEmpty(
  at: string,
  env: NodeJS.ProcessEnv = envFor(""),
): Promise<"initialised" | "unpushed" | "filled"> {
  try {
    await git(at, ["rev-parse", "--verify", "HEAD"], env);
    return "filled";
  } catch {
    /* unborn HEAD — the one case this exists for */
  }

  // An author, because a repository with no `user.email` configured refuses to commit at all.
  await git(
    at,
    [
      "-c",
      "user.name=studio",
      "-c",
      "user.email=studio@localhost",
      "commit",
      "--allow-empty",
      "-m",
      "les bibliotheques : premier commit",
    ],
    env,
  );
  try {
    await git(at, ["push", "-u", "origin", "HEAD"], env);
  } catch (e) {
    // Two machines racing to adopt the same new repository is the ordinary way this happens.
    console.warn(
      `[libraries] committed in ${at} but could not push: ${(e as Error).message}`,
    );
    return "unpushed";
  }
  console.log(`[libraries] initialised ${at}`);
  return "initialised";
}

/** Mount the account's libraries at `_libraries` and say whether anything was fetched (docs/libraries.md). */
export async function ensureLibraries(
  userEmail: string,
  root: string,
  uri: string,
): Promise<{ mounted: boolean }> {
  assertSshGitUri(uri);
  const at = join(root, LIBRARIES_DIR);
  const env = envFor(userEmail);

  const repo = await isRepo(root, env);
  if (repo) {
    const declared = await declaredUri(root, env);
    if (declared && normalizeGitUri(declared) !== normalizeGitUri(uri))
      throw new LibrariesMovedError(
        `${root} carries a libraries submodule pointing at ${declared}, and this account now says ${uri}. ` +
          `Change it in that workspace (git submodule set-url ${LIBRARIES_DIR} <uri>, then update it) — nothing here will rewrite it under a project that is using it.`,
      );
    if (isPopulated(at)) return { mounted: false };
    // Before anything is written: from here on a folder that is not the song's sits in the song's repo.
    await excludeFromProjectRepo(root, env);
    // The deploy key, which pl8 owns and this machine keeps a copy of.
    await ensureKey(userEmail);
    if (declared) {
      // Declared but empty: an ordinary fresh clone of a workspace that already committed it.
      await git(
        root,
        ["submodule", "update", "--init", "--", LIBRARIES_DIR],
        env,
      );
      return { mounted: true };
    }

    // Not declared at all: CLONED first and adopted second, since a new library has no commit yet.
    await run("git", ["clone", "--", uri, at], { env, timeout: TIMEOUT_MS });
    const started = await initIfEmpty(at, env);
    // Only NOW is the gitlink recorded, and not at all if that commit could not be pushed.
    if (started !== "unpushed") await registerSubmodule(root, uri, env);
    return { mounted: true };
  }

  // Not a git repository: no superproject to hold a gitlink, so the same folder is a plain clone.
  if (isPopulated(at)) return { mounted: false };
  await ensureKey(userEmail);
  await run("git", ["clone", "--", uri, at], { env, timeout: TIMEOUT_MS });
  await initIfEmpty(at, env);
  return { mounted: true };
}

/** Record the library's new commit in the PROJECT repo: path-limited, never pushed (docs/libraries.md). */
async function bumpGitlink(
  root: string,
  env: NodeJS.ProcessEnv,
  userEmail: string,
  message: string,
): Promise<string | null> {
  const paths = [".gitmodules", LIBRARIES_DIR];
  try {
    if (!(await isRepo(root, env))) return null;
    await git(root, ["add", "--", ...paths], env);
    const { stdout } = await git(
      root,
      ["diff", "--cached", "--name-only", "--", ...paths],
      env,
    );
    if (!stdout.trim()) return null; // already pointing at it — two saves, one version
    await git(
      root,
      [
        "-c",
        "user.name=studio",
        `-c`,
        `user.email=${userEmail}`,
        "commit",
        "-m",
        message,
        "--",
        ...paths,
      ],
      env,
    );
    const { stdout: sha } = await git(
      root,
      ["rev-parse", "--short", "HEAD"],
      env,
    );
    return sha.trim();
  } catch (e) {
    console.warn(
      `[libraries] could not record the new version: ${(e as Error).message}`,
    );
    return null;
  }
}

/** Commit the library, push it, and record the new version in the project — see docs/libraries.md. */
export async function commitLibraries(
  userEmail: string,
  root: string,
  message: string,
): Promise<{
  committed: boolean;
  pushed: boolean;
  /** The project commit that recorded the new library version, when one was made. */
  recorded?: string;
  note: string;
}> {
  const at = librariesDir(root);
  if (!existsSync(at))
    throw new Error("no libraries are mounted in this workspace");
  const env = envFor(userEmail);

  await git(at, ["add", "-A"], env);
  const { stdout: staged } = await git(
    at,
    ["diff", "--cached", "--name-only"],
    env,
  );
  const files = staged.split("\n").filter((s) => s.trim()).length;
  if (!files)
    return { committed: false, pushed: false, note: "nothing to commit" };

  // The author is the person editing, through `-c`: a machine must not write its identity into this checkout.
  await git(
    at,
    [
      "-c",
      "user.name=studio",
      `-c`,
      `user.email=${userEmail}`,
      "commit",
      "-m",
      message,
    ],
    env,
  );
  try {
    await git(at, ["push", "origin", "HEAD"], env);
  } catch (e) {
    // Committed here, refused there: the work is safe, but everyone else still has the old module.
    return {
      committed: true,
      pushed: false,
      note: `committed ${files} file(s), but the push failed — ${(e as Error).message}`,
    };
  }
  // The library is out there; now say which version this song uses — after the push, never before.
  const { stdout: version } = await git(
    at,
    ["rev-parse", "--short", "HEAD"],
    env,
  );
  const recorded = await bumpGitlink(
    root,
    env,
    userEmail,
    `libraries: ${version.trim()} — ${message}`,
  );
  return {
    committed: true,
    pushed: true,
    ...(recorded ? { recorded } : {}),
    note:
      `published ${files} file(s) to the libraries` +
      (recorded ? `, and this project now uses them` : ""),
  };
}

/** Where the libraries are mounted in this workspace, whether or not anything is there. */
export const librariesDir = (root: string): string => join(root, LIBRARIES_DIR);

// ── the account's library repository, which this machine now holds ────────────

/** Where the pointer lives. One line of JSON beside the workspaces, not in any of them. */
const pointerPath = (): string => join(studioHome(), "libraries.json");

/**
 * The library repository every project resolves its shared modules through, or null.
 *
 * It was pl8's — the one pointer that service held about git — and it is here because nothing
 * outlives this machine any more (apps/st0/frontend/docs/projects.md). `null` is the ordinary
 * state of a machine nobody has set one on, and the gate has a screen for it.
 */
export function librariesUri(): string | null {
  try {
    const raw = JSON.parse(readFileSync(pointerPath(), "utf8")) as {
      uri?: unknown;
    };
    return typeof raw.uri === "string" && raw.uri ? raw.uri : null;
  } catch {
    return null; // absent, or written by a hand that got it wrong
  }
}

/** SET it — the same URI twice is the same as once. */
export function setLibrariesUri(uri: string): void {
  mkdirSync(studioHome(), { recursive: true });
  writeFileSync(pointerPath(), `${JSON.stringify({ uri }, null, 2)}\n`);
}
