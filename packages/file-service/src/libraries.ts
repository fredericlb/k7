// libraries.ts — mount the account's library repository into a workspace, at `_libraries`.
// A git SUBMODULE where the workspace is a git repository, a plain clone where it is not.
// This is what `@st0/…` resolves against; nothing syncs modules from the médiathèque any more.
// Rationale: packages/song/docs/sharedFolders.md.

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertSshGitUri, normalizeGitUri } from "@studio/git-repos/uri";
import { LIBRARIES_DIR } from "@studio/song/sharedFolders";
import { ensureKey, sshCommand } from "./sshKeys.ts";

const run = promisify(execFile);

/** Bounded like every other git call here: a hung fetch must not hold a workspace open. */
const TIMEOUT_MS = 120_000;

function envFor(userEmail: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_SSH_COMMAND: sshCommand(userEmail),
    GIT_TERMINAL_PROMPT: "0",
    // Load-bearing: a personal `insteadOf` rewrite turns the SSH URI back to https, privilege
    // and all. The same two lines every git subprocess in this repo carries.
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

/** Does the mount hold anything? An uninitialised submodule is an empty folder. */
const isPopulated = (dir: string): boolean => {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

/**
 * A library repository already mounted here, pointing somewhere else.
 *
 * Its own error because it is the one outcome nobody should fix automatically: rewriting the
 * submodule would swap every `@st0/…` module under a project that is already using them, and
 * doing that silently while opening a song is how a mix changes for no visible reason. st0
 * says the same thing on the card that changes the setting.
 */
export class LibrariesMovedError extends Error {}

/**
 * Ensure the workspace has the account's libraries at `_libraries`, and answer whether
 * anything had to be fetched.
 *
 * Idempotent and cheap in the common case: a populated mount is left alone without a single
 * subprocess beyond the check. Called on every open rather than only on clone, because the
 * setting can be added after a workspace already exists — which is exactly what happens to
 * every workspace that predates this feature.
 */
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
    // The deploy key, which st0 owns and this machine keeps a copy of.
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
    // Not declared at all. `submodule add` STAGES `.gitmodules` and the gitlink and does not
    // commit — deliberately: committing is `project commit`, which is somebody's decision and
    // not something opening a song should do to their repository.
    await git(root, ["submodule", "add", "--", uri, LIBRARIES_DIR], env);
    return { mounted: true };
  }

  // Not a git repository — a workspace someone made rather than cloned. There is no
  // superproject to hold a gitlink, so the same folder is a plain clone instead. The shape on
  // disk is identical, which is all `@studio/song` looks at; what is lost is the pinned commit,
  // and a workspace that is not versioned had nowhere to pin it anyway.
  if (isPopulated(at)) return { mounted: false };
  await ensureKey(userEmail);
  await run("git", ["clone", "--", uri, at], { env, timeout: TIMEOUT_MS });
  return { mounted: true };
}

/** Where the libraries are mounted in this workspace, whether or not anything is there. */
export const librariesDir = (root: string): string => join(root, LIBRARIES_DIR);

/** Is the mount there and populated? What a route checks before blaming a missing module. */
export const hasLibraries = (root: string): boolean =>
  existsSync(join(root, LIBRARIES_DIR)) &&
  isPopulated(join(root, LIBRARIES_DIR));
