// libraries.ts — the account's LIBRARIES: a list of named git repositories this file service
// clones under `<studioHome>/libraries/<name>` and keeps at their latest commit. `@<name>/…`
// resolves against them, from every workspace of the account; no workspace holds a copy, and no
// workspace repository records one. Rationale: packages/song/docs/sharedFolders.md, mechanics:
// docs/libraries.md.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  assertSshGitUri,
  normalizeGitUri,
  repoName,
} from "@studio/git-repos/uri";
import {
  accountLibraries,
  DEFAULT_LIBRARY,
  isLibraryName,
  LIBRARIES_DIR,
  librariesHome,
} from "@studio/song/sharedFolders";
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

/** The author is the person editing, through `-c`: a machine must not write its identity into a checkout. */
const author = (userEmail: string): string[] => [
  "-c",
  "user.name=studio",
  "-c",
  `user.email=${userEmail || "studio@localhost"}`,
];

// ── the setting: which libraries the account has ─────────────────────────────

/** One library of the account: the name its refs use (`@<name>/…`) and where it is cloned from. */
export interface LibrarySetting {
  name: string;
  uri: string;
}

/** Where the list lives. One small JSON file beside the workspaces, not in any of them. */
const settingsPath = (): string => join(studioHome(), "libraries.json");

/**
 * The account's libraries, in the order they were added.
 *
 * The file used to hold ONE `{ "uri" }`; that reads as a library named `st0`, which is what every
 * `@st0/…` written before libraries had names meant. An empty list is the ordinary state of a new
 * machine, and st0's home page has a card for it.
 */
export function librarySettings(): LibrarySetting[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(settingsPath(), "utf8"));
  } catch {
    return []; // absent, or written by a hand that got it wrong
  }
  const r = raw as { uri?: unknown; libraries?: unknown };
  if (typeof r.uri === "string" && r.uri)
    return [{ name: DEFAULT_LIBRARY, uri: r.uri }];
  if (!Array.isArray(r.libraries)) return [];
  const out: LibrarySetting[] = [];
  for (const l of r.libraries as { name?: unknown; uri?: unknown }[])
    if (
      typeof l?.name === "string" &&
      typeof l?.uri === "string" &&
      isLibraryName(l.name) &&
      !out.some((o) => o.name === l.name)
    )
      out.push({ name: l.name, uri: l.uri });
  return out;
}

/** Why `list` cannot be the account's libraries, or null when it can. */
export function settingsProblem(list: LibrarySetting[]): string | null {
  const names = new Set<string>();
  const uris = new Set<string>();
  for (const l of list) {
    if (!isLibraryName(l.name))
      return `'${l.name}' cannot name a library — lowercase letters, digits and dashes, and not engine, workspace or meta`;
    if (names.has(l.name)) return `two libraries are called '${l.name}'`;
    names.add(l.name);
    try {
      assertSshGitUri(l.uri);
    } catch {
      return `not an SSH git URI: ${l.uri || "(empty)"}`;
    }
    const n = normalizeGitUri(l.uri);
    if (uris.has(n)) return `${l.uri} is listed twice`;
    uris.add(n);
  }
  return null;
}

/** SET the list — validated first, since a bad line would be read back as no library at all. */
export function setLibrarySettings(list: LibrarySetting[]): void {
  const problem = settingsProblem(list);
  if (problem) throw new Error(problem);
  mkdirSync(studioHome(), { recursive: true });
  writeFileSync(
    settingsPath(),
    `${JSON.stringify({ libraries: list }, null, 2)}\n`,
  );
}

/** The name a library gets when none is given: `st0` for the account's first, else its repository's. */
export function defaultLibraryName(
  uri: string,
  taken: LibrarySetting[],
): string {
  if (!taken.length) return DEFAULT_LIBRARY;
  return repoName(uri)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── the clones ────────────────────────────────────────────────────────────────

/** Where library `name` is cloned, whether or not it is there yet. */
export const libraryDir = (name: string): string => join(librariesHome(), name);

/** One git operation per library at a time: two opens racing must not run two fetches into one checkout. */
const locks = new Map<string, Promise<unknown>>();
function serial<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(name, next);
  return next.finally(() => {
    if (locks.get(name) === next) locks.delete(name);
  });
}

/** Does the folder hold anything? A clone that never finished is removed, so empty means absent. */
const isPopulated = (dir: string): boolean => {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

/** What a clone was cloned FROM, or null when there is no clone and no remote — docs/libraries.md. */
async function clonedFrom(
  at: string,
  userEmail = "",
): Promise<string | null> {
  try {
    // The URL as WRITTEN, not `remote get-url`'s: that one applies `insteadOf`, and the setting
    // compared against it is the URI the clone was made with.
    const { stdout } = await git(
      at,
      ["config", "--get", "remote.origin.url"],
      envFor(userEmail),
    );
    return stdout.trim() || null;
  } catch {
    return null; // not a clone, or a clone with no origin — both are "cannot say"
  }
}

/** What a checkout holds that its remote does not: edits not committed, commits not pushed. Empty when nothing would be lost. */
async function unpublished(
  at: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  // `git -C` climbs to whatever repository CONTAINS a folder that is not one itself — a workspace's,
  // whose status says nothing about this folder. Only a checkout of its own can be answered for.
  const { stdout: top } = await git(at, ["rev-parse", "--show-toplevel"], env);
  if (realpathSync(top.trim()) !== realpathSync(at))
    throw new Error(`${at} is not a git checkout of its own`);
  const out: string[] = [];
  const { stdout: status } = await git(at, ["status", "--porcelain"], env);
  const dirty = status.split("\n").filter((l) => l.trim()).length;
  if (dirty) out.push(`${dirty} file(s) changed and not published`);
  try {
    // `--not --remotes`: a checkout with no upstream yet still has its unpushed commits counted.
    const { stdout } = await git(
      at,
      ["rev-list", "--count", "HEAD", "--not", "--remotes"],
      env,
    );
    const ahead = Number(stdout.trim()) || 0;
    if (ahead) out.push(`${ahead} commit(s) not pushed`);
  } catch {
    /* unborn HEAD — nothing committed, so nothing unpushed */
  }
  return out;
}

/** Give a brand-new library repository a first commit, so it has a branch to fetch — see docs/libraries.md. */
async function initIfEmpty(
  at: string,
  env: NodeJS.ProcessEnv = envFor(""),
): Promise<"initialised" | "unpushed" | "filled"> {
  try {
    await git(at, ["rev-parse", "--verify", "HEAD"], env);
    return "filled";
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

/** What a sync did to one library, said so that a caller can show it as is. */
export interface LibrarySync {
  name: string;
  state: "cloned" | "updated" | "current" | "kept" | "failed";
  note: string;
}

/** Clone into a SIBLING first and rename it into place, so a clone that dies leaves no half a library behind. */
async function cloneInto(
  at: string,
  uri: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const home = librariesHome();
  mkdirSync(home, { recursive: true });
  // A dot-name is never a library name, so `accountLibraries` cannot see it while it fills.
  const partial = join(home, `.cloning-${Date.now()}-${process.pid}`);
  try {
    await run("git", ["clone", "--", uri, partial], {
      env,
      timeout: TIMEOUT_MS,
    });
    await initIfEmpty(partial, env);
    rmSync(at, { recursive: true, force: true });
    renameSync(partial, at);
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
}

/**
 * Bring ONE library to its remote's latest commit, cloning it first if this machine has none.
 *
 * "Latest" is the rule: no workspace pins a version. What it never does is lose work — a checkout
 * with edits not yet published, or commits not yet pushed, is left where it is and said so; the
 * builder's Save is what publishes them (docs/libraries.md).
 */
export function syncLibrary(
  userEmail: string,
  lib: LibrarySetting,
): Promise<LibrarySync> {
  return serial(lib.name, async () => {
    const at = libraryDir(lib.name);
    const env = envFor(userEmail);
    try {
      assertSshGitUri(lib.uri);
      await ensureKey(userEmail);
      if (!isPopulated(at)) {
        await cloneInto(at, lib.uri, env);
        return { name: lib.name, state: "cloned", note: `cloned ${lib.uri}` };
      }

      // The setting now names ANOTHER repository for this name: replaced, unless that loses work.
      const from = await clonedFrom(at, userEmail);
      if (!from || normalizeGitUri(from) !== normalizeGitUri(lib.uri)) {
        const left = await unpublished(at, env);
        if (left.length)
          return {
            name: lib.name,
            state: "kept",
            note: `'${lib.name}' is still the clone of ${from ?? "an unknown remote"} and holds ${left.join(" and ")} — publish or discard them before it can become ${lib.uri}`,
          };
        await cloneInto(at, lib.uri, env);
        return { name: lib.name, state: "cloned", note: `cloned ${lib.uri}` };
      }

      await git(at, ["fetch", "--prune", "origin"], env);
      const left = await unpublished(at, env);
      if (left.length)
        return {
          name: lib.name,
          state: "kept",
          note: `not updated: '${lib.name}' holds ${left.join(" and ")}`,
        };
      const before = (await git(at, ["rev-parse", "HEAD"], env)).stdout.trim();
      try {
        await git(at, ["merge", "--ff-only", "@{u}"], env);
      } catch {
        // No upstream yet (a repository adopted empty), or history rewritten upstream.
        return {
          name: lib.name,
          state: "kept",
          note: `not updated: '${lib.name}' cannot fast-forward to its remote`,
        };
      }
      const after = (await git(at, ["rev-parse", "HEAD"], env)).stdout.trim();
      return before === after
        ? { name: lib.name, state: "current", note: "up to date" }
        : {
            name: lib.name,
            state: "updated",
            note: `updated to ${after.slice(0, 7)}`,
          };
    } catch (e) {
      return { name: lib.name, state: "failed", note: (e as Error).message };
    }
  });
}

/** When each library was last synced, so opening five projects in a minute fetches once. */
const lastSync = new Map<string, number>();

/** How recent a sync must be for an OPEN to skip it; an explicit update never skips. */
const SYNC_EVERY_MS = 60_000;

/** Sync every library of the account — all of them at once, each serialised against itself. */
export async function syncLibraries(
  userEmail: string,
  opts: { force?: boolean } = {},
): Promise<LibrarySync[]> {
  const now = Date.now();
  const due = librarySettings().filter(
    (l) =>
      opts.force ||
      !isPopulated(libraryDir(l.name)) ||
      now - (lastSync.get(l.name) ?? 0) >= SYNC_EVERY_MS,
  );
  const results = await Promise.all(due.map((l) => syncLibrary(userEmail, l)));
  for (const r of results)
    if (r.state !== "failed") lastSync.set(r.name, Date.now());
  return results;
}

/**
 * What an OPEN does: every library brought to its latest, WAITED FOR only when one is not cloned
 * yet. An update of a clone already here runs behind the open — an unreachable host must not hold
 * a song back for two minutes, and the module caches notice the files when they land
 * (docs/moduleWatch.md).
 */
export async function refreshLibraries(userEmail: string): Promise<void> {
  const log = (results: LibrarySync[]) => {
    for (const r of results)
      if (r.state === "failed" || r.state === "kept")
        console.warn(`[libraries] ${r.name}: ${r.note}`);
  };
  const sync = syncLibraries(userEmail).then(log, (e: Error) =>
    console.warn(`[libraries] ${e.message}`),
  );
  if (librarySettings().some((l) => !isPopulated(libraryDir(l.name))))
    await sync;
}

/** Remove the clones of libraries the account no longer lists — never one holding unpublished work. */
export async function pruneLibraries(
  userEmail: string,
): Promise<LibrarySync[]> {
  const listed = new Set(librarySettings().map((l) => l.name));
  const env = envFor(userEmail);
  const out: LibrarySync[] = [];
  for (const { name, root } of accountLibraries()) {
    if (listed.has(name)) continue;
    await serial(name, async () => {
      // A folder git cannot read is KEPT: "cannot tell" is never "nothing to lose".
      const left = await unpublished(root, env).catch((e: Error) => [
        `contents git cannot account for (${e.message.split("\n")[0]})`,
      ]);
      if (left.length) {
        out.push({
          name,
          state: "kept",
          note: `'${name}' is no longer one of the account's libraries but holds ${left.join(" and ")} — publish or discard them, and it will be removed`,
        });
        return;
      }
      rmSync(root, { recursive: true, force: true });
      lastSync.delete(name);
    });
  }
  return out;
}

// ── publishing: the builder's Save ───────────────────────────────────────────

/** What publishing one library did. */
export interface LibraryPublish {
  name: string;
  committed: boolean;
  pushed: boolean;
  note: string;
}

/** Commit everything changed in library `name` and push it — see docs/libraries.md. */
export function commitLibrary(
  userEmail: string,
  name: string,
  message: string,
): Promise<LibraryPublish> {
  return serial(name, async () => {
    const at = libraryDir(name);
    if (!isLibraryName(name) || !existsSync(at))
      throw new Error(`the account has no library called '${name}'`);
    const env = envFor(userEmail);

    await git(at, ["add", "-A"], env);
    const { stdout: staged } = await git(
      at,
      ["diff", "--cached", "--name-only"],
      env,
    );
    const files = staged.split("\n").filter((s) => s.trim()).length;
    if (files)
      await git(at, [...author(userEmail), "commit", "-m", message], env);
    // Pushed even when nothing was staged now: an earlier Save whose push failed left a commit here.
    const left = await unpublished(at, env);
    if (!files && !left.length)
      return {
        name,
        committed: false,
        pushed: false,
        note: "nothing to publish",
      };
    try {
      await git(at, ["push", "origin", "HEAD"], env);
    } catch (e) {
      // Committed here, refused there: the work is safe, but everyone else still has the old module.
      return {
        name,
        committed: files > 0,
        pushed: false,
        note: `committed ${files} file(s) to '${name}', but the push failed — ${(e as Error).message}`,
      };
    }
    lastSync.set(name, Date.now());
    return {
      name,
      committed: files > 0,
      pushed: true,
      note: files
        ? `published ${files} file(s) to '${name}'`
        : `published '${name}'s earlier commits`,
    };
  });
}

/** Publish every library that has something to publish, or only `names`. */
export async function commitLibraries(
  userEmail: string,
  message: string,
  names?: string[],
): Promise<{
  committed: boolean;
  pushed: boolean;
  note: string;
  libraries: LibraryPublish[];
}> {
  const which = names ?? accountLibraries().map((l) => l.name);
  if (!which.length) throw new Error("the account has no libraries");
  const libraries: LibraryPublish[] = [];
  for (const name of which)
    libraries.push(await commitLibrary(userEmail, name, message));
  const touched = libraries.filter((l) => l.note !== "nothing to publish");
  return {
    committed: libraries.some((l) => l.committed),
    // True only when everything that had something to publish got there.
    pushed: touched.length > 0 && touched.every((l) => l.pushed),
    note: touched.length
      ? touched.map((l) => l.note).join("; ")
      : "nothing to publish",
    libraries,
  };
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
 * what to do. It resolves nothing any more either way: `@<name>/…` reads the account's clones.
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
