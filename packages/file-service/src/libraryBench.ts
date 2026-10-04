// libraryBench.ts — the clone an admin's bench EDITS: one per library, cloned from that library's
// remote with the ADMIN's own key into `<studioHome>/bench-libraries/<name>`, and read in place of
// the hub's clone while it is the open bench (song's `setLibraryOverlay`). It is the only library
// copy any write may reach. It is kept until a push leaves it clean; a push asks the hub to pull
// its own. Rationale: docs/libraries.md.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  isLibraryName,
  librariesHome,
  libraryOverlay,
  setLibraryOverlay,
} from "@studio/song/sharedFolders";
import { studioHome } from "@studio/song/studioHome";
import type { BenchLibraryStatus } from "@studio/web-protocol";
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

/** Where the bench clones live — the tunnel's `bench-<account>` root (packages/file-hub/binding.ts). */
const benchHome = (): string => join(studioHome(), "bench-libraries");
/** Which one is the open bench, so a restarted service reads it again. */
const activeFile = (): string => join(benchHome(), ".active");

/** One git operation per bench clone at a time: a commit must not run under a discard. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.catch(() => undefined).then(fn);
  chain = next;
  return next;
}

/** At start: the bench that was open is read again, its clone still being there. */
export function restoreLibraryBench(): void {
  let name = "";
  try {
    name = readFileSync(activeFile(), "utf8").trim();
  } catch {
    return;
  }
  const at = join(benchHome(), name);
  if (isLibraryName(name) && isPopulated(at))
    setLibraryOverlay({ name, root: at });
}

/** No library is being edited any more: every library reads the hub's clone again. */
export function closeLibraryBench(): void {
  setLibraryOverlay(null);
  rmSync(activeFile(), { force: true });
}

/** The URI the hub cloned `name` from — the bench's clone comes from the same repository. */
async function uriOf(name: string): Promise<string> {
  const shared = join(librariesHome(), name);
  if (!isPopulated(shared))
    throw new Error(
      `the server holds no clone of '${name}' — is the server's key a deploy key of it?`,
    );
  const { stdout } = await git(
    shared,
    ["config", "--get", "remote.origin.url"],
    process.env,
  );
  return stdout.trim();
}

/** Open the bench on `name`: its clone made or brought forward, the others left clean removed, and it read in place of the hub's. */
export function openLibraryBench(
  userEmail: string,
  name: string,
): Promise<void> {
  return serial(async () => {
    if (!isLibraryName(name))
      throw new Error(`'${name}' cannot name a library`);
    const home = benchHome();
    const at = join(home, name);
    const env = envFor(userEmail);
    await ensureKey(userEmail);
    if (!isPopulated(at)) {
      const uri = await uriOf(name);
      mkdirSync(home, { recursive: true });
      // A dot-name is never a library name: a clone that dies leaves nothing to be read as one.
      const partial = join(home, `.cloning-${Date.now()}-${process.pid}`);
      try {
        await run("git", ["clone", "-q", "--", uri, partial], {
          env,
          timeout: TIMEOUT_MS,
        });
        await initIfEmpty(partial, env);
        rmSync(at, { recursive: true, force: true });
        renameSync(partial, at);
      } finally {
        rmSync(partial, { recursive: true, force: true });
      }
    } else {
      const { changed, ahead } = await unpublishedCounts(at, env);
      // Work not pushed is kept as it is; a clean clone is brought to what was pushed since.
      if (!changed && !ahead) {
        await git(at, ["fetch", "--prune", "origin"], env).catch(
          () => undefined,
        );
        await git(at, ["merge", "--ff-only", "-q", "@{u}"], env).catch(
          () => undefined,
        );
      }
    }
    for (const other of readdirSync(home))
      if (other !== name && isLibraryName(other)) {
        const left = await unpublishedCounts(join(home, other), env).catch(
          () => null,
        );
        if (left && !left.changed && !left.ahead)
          rmSync(join(home, other), { recursive: true, force: true });
      }
    setLibraryOverlay({ name, root: at });
    writeFileSync(activeFile(), `${name}\n`);
  });
}

/** What the open bench's clone holds that its remote does not, or null when no bench is open. */
export async function libraryBenchStatus(
  userEmail: string,
): Promise<BenchLibraryStatus | null> {
  const open = libraryOverlay();
  if (!open || !existsSync(open.root)) return null;
  const { changed, ahead } = await unpublishedCounts(
    open.root,
    envFor(userEmail),
  );
  return { library: open.name, changed, ahead };
}

/** Commit everything changed on the bench and push it; the hub then pulls its own clone. */
export function commitLibraryBench(
  userEmail: string,
  message: string,
): Promise<{ pushed: boolean; note: string }> {
  return serial(async () => {
    const open = libraryOverlay();
    if (!open) throw new Error("no library is open on the bench");
    const env = envFor(userEmail);
    await git(open.root, ["add", "-A"], env);
    const { stdout: staged } = await git(
      open.root,
      ["diff", "--cached", "--name-only"],
      env,
    );
    const files = staged.split("\n").filter((s) => s.trim()).length;
    if (files)
      await git(
        open.root,
        [...author(userEmail), "commit", "-q", "-m", message],
        env,
      );
    try {
      await git(open.root, ["push", "-u", "origin", "HEAD"], env);
    } catch (e) {
      // Committed here, refused there: the work is safe, but nobody else has it yet.
      return {
        pushed: false,
        note: `committed to '${open.name}', but the push failed — ${(e as Error).message}`,
      };
    }
    await askHubSync({ name: open.name, pull: true }).catch((e: Error) =>
      console.warn(
        `[libraries] pushed '${open.name}' but the hub did not pull: ${e.message}`,
      ),
    );
    return {
      pushed: true,
      note: `published ${files} file(s) to '${open.name}'`,
    };
  });
}

/** The hub pulled `name`: its bench clone goes, open or not, unpushed work included. */
export function dropLibraryBench(name: string): Promise<void> {
  return serial(async () => {
    if (!isLibraryName(name))
      throw new Error(`'${name}' cannot name a library`);
    if (libraryOverlay()?.name === name) closeLibraryBench();
    rmSync(join(benchHome(), name), { recursive: true, force: true });
  });
}

/** Throw away what the bench changed: its clone made exactly its remote again. */
export function discardLibraryBench(userEmail: string): Promise<void> {
  return serial(async () => {
    const open = libraryOverlay();
    if (!open) throw new Error("no library is open on the bench");
    const env = envFor(userEmail);
    await git(open.root, ["fetch", "--prune", "origin"], env).catch(
      () => undefined,
    );
    const upstream = await git(
      open.root,
      ["rev-parse", "--verify", "-q", "@{u}"],
      env,
    )
      .then(() => "@{u}")
      .catch(() => "HEAD");
    await git(open.root, ["reset", "--hard", "-q", upstream], env);
    await git(open.root, ["clean", "-fdq"], env);
  });
}
