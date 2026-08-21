// libraries.ts — mount the account's library repository into a workspace, at `_libraries`.
// A git SUBMODULE where the workspace is a git repository, a plain clone where it is not.
// This is what `@st0/…` resolves against; nothing syncs modules from the médiathèque any more.
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
import { CATALOGUE, isFresh, MODULES_DIR } from "@studio/dsp/catalogue";
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

/**
 * Keep `_libraries` out of the PROJECT repository's `git add -A`.
 *
 * The leak this closes: when the mount is a checkout the superproject has NOT registered — the
 * seed could not be pushed, or `submodule add` has yet to run — `_libraries` is an untracked
 * folder inside somebody's song repository, and `project commit` does `git add -A` over the
 * whole tree. Git would then either commit the entire catalogue INTO the song, or record an
 * "embedded repository" gitlink with no `.gitmodules` beside it, which is a submodule nobody
 * who clones can resolve. Both put the library inside a project repository, which is the one
 * place it must never be.
 *
 * `.git/info/exclude` and not `.gitignore`, and that is the point: it is per-checkout, never
 * committed, and never travels — so this touches no tracked file of a repository that is not
 * ours. Harmless once the submodule IS registered, since an ignore rule has no say over a path
 * git already tracks.
 *
 * Best effort: an exclude that could not be written costs the guard, not the mount.
 */
export async function excludeFromProjectRepo(
  root: string,
  env: NodeJS.ProcessEnv = envFor(""),
): Promise<void> {
  const line = `/${LIBRARIES_DIR}/`;
  try {
    // Asked for rather than assumed to be `<root>/.git`: that is a FILE in a worktree or a
    // submodule, and writing `info/exclude` under it would make a file inside a file.
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

/**
 * Record the checkout at `_libraries` as a submodule of the workspace.
 *
 * STAGES `.gitmodules` and the gitlink and does not commit — deliberately: committing is
 * `project commit`, somebody's decision, not something opening a song does to their repository.
 *
 * **`--force`, and it is not optional.** `excludeFromProjectRepo` has just written
 * `/_libraries/` into this repository's `.git/info/exclude`, and `git submodule add` refuses an
 * ignored path: *"The following paths are ignored by one of your .gitignore files … use -f"*.
 * Without it every first mount left the library seeded, pushed and **unregistered** — the exact
 * half-state the exclusion exists to make survivable, reached by the code that was supposed to
 * end it. Found in a real workspace, not in a test: the test built its fixture with `-f`
 * already, which is how a workaround in a fixture hides the bug in the thing it is fixturing.
 *
 * The two are not in conflict. The exclusion guards the window where the mount is untracked;
 * this is the act that closes that window, so overriding it here is the point.
 */
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

/**
 * A library repository already mounted here, pointing somewhere else.
 *
 * Its own error because it is the one outcome nobody should fix automatically: rewriting the
 * submodule would swap every `@st0/…` module under a project that is already using them, and
 * doing that silently while opening a song is how a mix changes for no visible reason. pl8
 * says the same thing on the card that changes the setting.
 */
export class LibrariesMovedError extends Error {}

/**
 * Fill a brand-new library repository with the modules this build ships, commit, and push.
 *
 * **Two independent questions, and conflating them is what broke this before.** A gitlink has to
 * point AT a commit, so a repository somebody just created through a web UI — unborn HEAD —
 * needs one made whatever else happens (`git submodule add` on an unborn HEAD fails). And a
 * library with no `modules/` needs the catalogue, so that `@st0/audio/utility/tempo` and its
 * siblings resolve. A repository can be in either state without the other: one created with a
 * README has a commit and no modules, and this seeds it.
 *
 * The catalogue used to be copied from the hosted médiathèque over HTTP, and when that volume
 * stopped holding modules the copy was dropped and only the empty commit kept — which left every
 * `@st0/…` ref in a new account resolving to nothing, silently, including the four a scaffolded
 * SET writes for its decks. It is EMBEDDED now (`@studio/dsp/catalogue`), and it has to be:
 * this service is esbuilt into a single .mjs inside the tray, so there is no `packages/dsp/`
 * beside it to read at runtime. See packages/dsp/docs/catalogue.md.
 *
 * Never touches an existing `modules/`. The account's own modules live there, and overwriting
 * one with the version this build happens to ship would be silent data loss — which is why the
 * question is asked of the FOLDER rather than of a flag somebody has to keep.
 *
 * Answers what happened, because the caller's next move depends on it: `"filled"` (nothing to
 * do), `"seeded"`, `"initialised"` (a commit, no catalogue needed), or `"unpushed"` (committed
 * here, refused there).
 */
export async function seedIfEmpty(
  at: string,
  env: NodeJS.ProcessEnv = envFor(""),
): Promise<"seeded" | "initialised" | "unpushed" | "filled"> {
  const fresh = isFresh(at);
  let unborn = false;
  try {
    await git(at, ["rev-parse", "--verify", "HEAD"], env);
  } catch {
    unborn = true;
  }
  if (!fresh && !unborn) return "filled";

  if (fresh) {
    for (const [rel, text] of Object.entries(CATALOGUE)) {
      const dest = join(at, MODULES_DIR, ...rel.split("/"));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text, "utf8");
    }
    await git(at, ["add", "--", MODULES_DIR], env);
  }

  // An author, because a repository with no `user.email` configured refuses to commit at all —
  // and this runs on a machine nobody has set up for git. `--allow-empty` because the unborn
  // case may have nothing to write, and a commit that fails here costs the gitlink.
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
      fresh
        ? "les bibliotheques : le catalogue de depart"
        : "les bibliotheques : premier commit",
    ],
    env,
  );
  try {
    await git(at, ["push", "-u", "origin", "HEAD"], env);
  } catch (e) {
    // Two machines racing to fill the same new repository is the ordinary way this happens: the
    // loser's push is rejected, and the winner's commit holds the same catalogue. Say so and
    // leave the checkout alone — the caller declines to record a gitlink, so nothing downstream
    // ends up pointing at a commit that never left here.
    console.warn(
      `[libraries] committed in ${at} but could not push: ${(e as Error).message}`,
    );
    return "unpushed";
  }
  if (!fresh) {
    console.log(`[libraries] initialised ${at}`);
    return "initialised";
  }
  console.log(
    `[libraries] seeded ${at} with ${Object.keys(CATALOGUE).length} catalogue file(s)`,
  );
  return "seeded";
}

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
    // Before anything is written into the workspace: from here on there is a folder inside
    // somebody's song repository that is not the song's, and `project commit` sweeps the tree.
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

    /**
     * Not declared at all — the first workspace to mount this library.
     *
     * CLONED first and adopted second, rather than one `git submodule add`, and the reason is
     * the case this whole path exists for: a library repository somebody just created has NO
     * COMMITS, and a gitlink has to point at one. `submodule add` on an unborn HEAD fails.
     * Cloning it, filling it (below), and only then adding it hands `submodule add` a repo with
     * a commit — and `submodule add` on a path that is already a checkout adopts it rather than
     * cloning a second time.
     */
    await run("git", ["clone", "--", uri, at], { env, timeout: TIMEOUT_MS });
    const started = await seedIfEmpty(at, env);
    // Only NOW is the gitlink recorded — and not at all if the seed could not be pushed. A
    // gitlink is a promise that a commit is fetchable; pointing it at one that never left this
    // machine would break the workspace for everybody who clones it, including you tomorrow.
    if (started !== "unpushed") await registerSubmodule(root, uri, env);
    return { mounted: true };
  }

  // Not a git repository — a workspace someone made rather than cloned. There is no
  // superproject to hold a gitlink, so the same folder is a plain clone instead. The shape on
  // disk is identical, which is all `@studio/song` looks at; what is lost is the pinned commit,
  // and a workspace that is not versioned had nowhere to pin it anyway.
  if (isPopulated(at)) return { mounted: false };
  await ensureKey(userEmail);
  await run("git", ["clone", "--", uri, at], { env, timeout: TIMEOUT_MS });
  await seedIfEmpty(at, env);
  return { mounted: true };
}

/**
 * Record the library's new commit in the PROJECT repository — the gitlink, and `.gitmodules`
 * if it is not committed yet.
 *
 * This is what "the project uses that version of the library" is written down as. Without it
 * the working copy is already on the new module (the submodule is checked out at it) while the
 * song still SAYS the old one, so a clone somewhere else gets yesterday's module and nothing
 * explains why.
 *
 * Two things keep this from being a liberty taken with somebody's repository:
 *
 * - **Path-limited, always.** `git commit -- .gitmodules _libraries` commits those paths and
 *   nothing else, whatever is dirty or staged around them. A `git add -A` here would sweep half
 *   a song into a commit about a module.
 * - **Only after the library push succeeded.** A gitlink promises the commit is fetchable;
 *   pointing one at a commit that never left this machine breaks the song for everyone who
 *   clones it. The caller enforces the order — this is only reached on a push that landed.
 *
 * NOT pushed. Pushing a song is `project commit`, which is a decision about somebody's work and
 * not a side effect of saving a module. Best effort besides: a workspace that is not a git
 * repository has no gitlink to move, and a bump that fails costs the record, never the save.
 */
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

/**
 * Commit everything in the library checkout, push it, and record the new version in the
 * project. What a Save in the module builder does, once the files are on disk.
 *
 * Two repositories and two different rules. The LIBRARY gets the content — a commit and a push,
 * because that is what makes the module everyone else's. The PROJECT gets one line: its gitlink,
 * committed path-limited so nothing else in flight goes with it, and never pushed — pushing a
 * song is `project commit`, a decision about somebody's work.
 *
 * Nothing to commit is not a failure. Two saves in a row with no edit between them, or a save
 * of files another workspace on this machine already committed, both land there.
 */
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

  // The author is the person editing, so the history says who. `-c` rather than a written
  // config: this checkout is the account's library, not this machine's, and a machine must not
  // leave its own identity in it.
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
    // Committed here, refused there — someone else pushed first, or the network is gone. The
    // work is safe and the next Save pushes both commits; saying "saved" and nothing else would
    // be the lie, since everyone else still has the old module.
    return {
      committed: true,
      pushed: false,
      note: `committed ${files} file(s), but the push failed — ${(e as Error).message}`,
    };
  }
  // The library is out there; now say which version this song uses. After the push and never
  // before it — see bumpGitlink.
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
