// libraryEdits.ts — an ADMIN's own clone of each library, made with the admin's key under
// `<studioHome>/library-edits/<name>` and read in place of the hub's clone (song's
// `setLibraryOverlays`): the only library copies any write may reach, from any project. At each
// open a clone with nothing unpushed is made its remote again, so it never hides a push from
// elsewhere; one holding work keeps it until it is committed and pushed, or discarded.
// Rationale: docs/libraries.md.

import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  isLibraryName,
  librariesHome,
  libraryOverlays,
  setLibraryOverlays,
} from "@studio/song/sharedFolders";
import { studioHome } from "@studio/song/studioHome";
import { LIBRARY_EDITS_DIR } from "@studio/song-schema/moduleTypes";
import type { LibraryEditsStatus } from "@studio/web-protocol";
import {
  askHubSync,
  author,
  envFor,
  git,
  initIfEmpty,
  isPopulated,
  TIMEOUT_MS,
  unpublishedCounts,
} from "./libraries.ts";
import { ensureKey } from "./sshKeys.ts";

const run = promisify(execFile);

/** How recent a refresh must be for an open to skip it: every project open asks. */
const REFRESH_EVERY_MS = 60_000;

const editsHome = (): string => join(studioHome(), LIBRARY_EDITS_DIR);

/** One git operation on the edit clones at a time: a commit must not run under a refresh. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.catch(() => undefined).then(fn);
  chain = next;
  return next;
}

let lastRefresh = 0;

/** The libraries the hub holds a clone of — the ones there is anything to edit. */
function hubLibraries(): string[] {
  try {
    return readdirSync(librariesHome(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && isLibraryName(e.name))
      .filter((e) => isPopulated(join(librariesHome(), e.name)))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** The edit clones already on disk. */
function editClones(): string[] {
  try {
    return readdirSync(editsHome()).filter(
      (n) => isLibraryName(n) && isPopulated(join(editsHome(), n)),
    );
  } catch {
    return [];
  }
}

/** At start: the clones there are read again, before any open has refreshed them. */
export function restoreLibraryEdits(): void {
  setLibraryOverlays(
    editClones().map((name) => ({ name, root: join(editsHome(), name) })),
  );
}

/** The URI the hub cloned `name` from — the edit clone comes from the same repository. */
async function uriOf(name: string): Promise<string> {
  const { stdout } = await git(
    join(librariesHome(), name),
    ["config", "--get", "remote.origin.url"],
    process.env,
  );
  return stdout.trim();
}

/** Clone `name` with the admin's key, through a dot-named sibling no reader takes for a library. */
async function cloneEdits(name: string, env: NodeJS.ProcessEnv): Promise<void> {
  const home = editsHome();
  mkdirSync(home, { recursive: true });
  const partial = join(home, `.cloning-${Date.now()}-${process.pid}`);
  try {
    await run("git", ["clone", "-q", "--", await uriOf(name), partial], {
      env,
      timeout: TIMEOUT_MS,
    });
    await initIfEmpty(partial, env);
    rmSync(join(home, name), { recursive: true, force: true });
    renameSync(partial, join(home, name));
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
}

/** Make a clone with nothing unpushed EXACTLY its remote; one holding work is left as it is. */
async function followRemote(at: string, env: NodeJS.ProcessEnv): Promise<void> {
  const { changed, ahead } = await unpublishedCounts(at, env);
  if (changed || ahead) return;
  await git(at, ["fetch", "--prune", "origin"], env);
  const upstream = await git(at, ["rev-parse", "--verify", "-q", "@{u}"], env)
    .then(() => true)
    .catch(() => false);
  if (!upstream) return;
  await git(at, ["reset", "--hard", "-q", "@{u}"], env);
  await git(at, ["clean", "-fdq"], env);
}

/** What an OPEN does: an admin reads their clones in place of the hub's, anyone else the hub's; WAITED FOR only where a clone is missing, unless `force`. */
export async function refreshLibraryEdits(
  userEmail: string,
  admin: boolean,
  force = false,
): Promise<void> {
  if (!admin) {
    setLibraryOverlays([]);
    return;
  }
  const listed = hubLibraries();
  const here = listed.filter((n) => isPopulated(join(editsHome(), n)));
  // What is here is read at once: the fetches below take seconds per library, and a song must not wait on them.
  setLibraryOverlays(
    here.map((name) => ({ name, root: join(editsHome(), name) })),
  );
  const work = syncLibraryEdits(userEmail, force);
  if (force || here.length < listed.length) return work;
  void work.catch((e: Error) => console.warn(`[libraries] ${e.message}`));
}

/** Each clone made, or brought to its remote while it holds nothing unpushed — one at a time, at most once a minute unless `force`. */
function syncLibraryEdits(userEmail: string, force: boolean): Promise<void> {
  return serial(async () => {
    if (!force && Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
    lastRefresh = Date.now();
    const env = envFor(userEmail);
    await ensureKey(userEmail);
    const listed = hubLibraries();
    const edited: { name: string; root: string }[] = [];
    for (const name of listed) {
      const at = join(editsHome(), name);
      try {
        if (!isPopulated(at)) await cloneEdits(name, env);
        else await followRemote(at, env);
      } catch (e) {
        // A clone the admin's key cannot make stays the hub's, read-only; one already here is still theirs.
        console.warn(`[libraries] ${name}: ${(e as Error).message.trim()}`);
      }
      if (isPopulated(at)) edited.push({ name, root: at });
    }
    // A library dropped from the list: its clone goes when nothing in it would be lost.
    for (const name of editClones())
      if (!listed.includes(name)) {
        const left = await unpublishedCounts(
          join(editsHome(), name),
          env,
        ).catch(() => null);
        if (left && !left.changed && !left.ahead)
          rmSync(join(editsHome(), name), { recursive: true, force: true });
      }
    setLibraryOverlays(edited);
  });
}

/** Every edited library holding work its remote does not. */
export async function libraryEditsStatus(
  userEmail: string,
): Promise<LibraryEditsStatus> {
  const env = envFor(userEmail);
  const libraries: LibraryEditsStatus["libraries"] = [];
  for (const { name, root } of libraryOverlays()) {
    const counts = await unpublishedCounts(root, env).catch(() => null);
    if (counts && (counts.changed || counts.ahead))
      libraries.push({ library: name, ...counts });
  }
  return { libraries };
}

/** Commit what changed in every edited library and push it; the hub then pulls its own clone of each. */
export function commitLibraryEdits(
  userEmail: string,
  message: string,
): Promise<{ pushed: boolean; note: string }> {
  return serial(async () => {
    const env = envFor(userEmail);
    const notes: string[] = [];
    let pushed = true;
    for (const { name, root } of libraryOverlays()) {
      const { changed, ahead } = await unpublishedCounts(root, env);
      if (!changed && !ahead) continue;
      await git(root, ["add", "-A"], env);
      if (changed)
        await git(
          root,
          [...author(userEmail), "commit", "-q", "-m", message],
          env,
        );
      try {
        await git(root, ["push", "-u", "origin", "HEAD"], env);
      } catch (e) {
        // Committed here, refused there: the work is safe, but nobody else has it yet.
        pushed = false;
        notes.push(
          `'${name}' committed, but the push failed — ${(e as Error).message}`,
        );
        continue;
      }
      await askHubSync({ name, pull: true }).catch((e: Error) =>
        console.warn(
          `[libraries] pushed '${name}' but the hub did not pull: ${e.message}`,
        ),
      );
      notes.push(`published '${name}'`);
    }
    if (!notes.length) throw new Error("no library holds anything to publish");
    return { pushed, note: notes.join("; ") };
  });
}

/** Throw away what changed in every edited library: each clone made exactly its remote again. */
export function discardLibraryEdits(userEmail: string): Promise<void> {
  return serial(async () => {
    const env = envFor(userEmail);
    for (const { root } of libraryOverlays()) {
      await git(root, ["fetch", "--prune", "origin"], env).catch(
        () => undefined,
      );
      const upstream = await git(
        root,
        ["rev-parse", "--verify", "-q", "@{u}"],
        env,
      )
        .then(() => "@{u}")
        .catch(() => "HEAD");
      await git(root, ["reset", "--hard", "-q", upstream], env);
      await git(root, ["clean", "-fdq"], env);
    }
  });
}

/** The hub pulled `name`: this account's clone of it goes, unpushed work included, and the next open clones it again. */
export function dropLibraryEdits(name: string): Promise<void> {
  return serial(async () => {
    if (!isLibraryName(name))
      throw new Error(`'${name}' cannot name a library`);
    setLibraryOverlays(libraryOverlays().filter((l) => l.name !== name));
    rmSync(join(editsHome(), name), { recursive: true, force: true });
    lastRefresh = 0;
  });
}
