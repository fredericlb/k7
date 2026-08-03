// mediatekPull.ts — keeps this machine's médiathèque cache in step with the hosted library,
// for the modules the open songs actually name. Unattended: a module edited in the médiathèque
// lands here on its own and the projects using it recompile. See docs/mediatekPull.md.

import { syncFamily } from "@studio/mediatek/cache";
import { remoteLibrary } from "@studio/mediatek/remote";
import { mediatekPathPrefix, mediatekRefs } from "@studio/song/mediatekRefs";
import { liveWorkspaces } from "./workspaces.ts";

/** How often the owner's change token is asked for. Cheap on the server — a walk it already
 *  caches — but it is a network call per tick, so not per second either. */
const EVERY_MS = 60_000;
/** The first pull, delayed so a cold boot isn't competing with the engine coming up. */
const FIRST_MS = 5_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** The owner's token and the scope, as of the last sync that landed cleanly. Both in MEMORY:
 *  `markSynced` records "this cache is in step with the owner", which a scoped sync has no
 *  right to claim — losing this on restart costs one manifest fetch and no downloads. */
let lastRevision = "";
let lastScope = "";
/** The last error reported, so a library that is down says so once and not every minute. */
let lastError = "";

/** The library-relative folders the open songs reach for, sorted so the signature is stable. */
function scope(): string[] {
  const refs = new Set<string>();
  for (const ws of liveWorkspaces()) {
    const dir = ws.activeProjectPath();
    if (!dir) continue;
    try {
      for (const ref of mediatekRefs(dir)) refs.add(ref);
    } catch {
      /* a project that won't parse names nothing we can fetch — the compiler reports it */
    }
  }
  return [...refs].sort().map(mediatekPathPrefix);
}

/**
 * One pass: ask what the library is at, and fetch what moved within the scope.
 *
 * Exported for the tests and for a caller that wants it now; the loop below is the normal
 * driver. Never throws — a hosted library that is unreachable must cost the update, not the
 * file service.
 */
export async function pullOnce(): Promise<void> {
  const base = process.env.MEDIATEK_URL;
  if (!base || running) return;
  const prefixes = scope();
  // Nothing open names the library: no fetch, and no token recorded either, or the first song
  // that does would be told everything is already in step.
  if (!prefixes.length) return;

  running = true;
  try {
    const source = remoteLibrary({ base, token: process.env.MEDIATEK_TOKEN });
    const revision = (await source.revisions()).modules ?? "";
    const signature = prefixes.join("|");
    // Two reasons to sync, and the scope is the one a change token cannot see: a song that
    // starts naming a module the cache never held moved nothing on the server.
    if (revision === lastRevision && signature === lastScope) return;

    const report = await syncFamily(source, "modules", (p) =>
      prefixes.some((prefix) => p.startsWith(prefix)),
    );
    if (report.fetched.length || report.dropped.length) {
      // The compiled doc is memoised per workspace and only our own writes invalidate it, so
      // without this a module that just landed would sit on disk behind yesterday's compile.
      for (const ws of liveWorkspaces()) ws.invalidateProjectDoc();
      console.log(
        `   mediatek: ${report.fetched.length} file(s) in, ${report.dropped.length} out`,
      );
    }
    // A partial sync stays stale on purpose: the files that failed are retried next tick.
    if (!report.failed.length) {
      lastRevision = revision;
      lastScope = signature;
    }
    lastError = "";
  } catch (e) {
    const message = (e as Error).message;
    if (message !== lastError) {
      console.warn(`   mediatek pull: ${message}`);
      lastError = message;
    }
  } finally {
    running = false;
  }
}

/** Start the loop. A no-op with no hosted library configured — the local folder is then not a
 *  cache of anything, which is a working state (see fileServiceProcess.ts). */
export function startMediatekPuller(): void {
  if (timer || !process.env.MEDIATEK_URL) return;
  setTimeout(() => void pullOnce(), FIRST_MS).unref();
  timer = setInterval(() => void pullOnce(), EVERY_MS);
  timer.unref();
}

/** Stop the loop and forget what was seen — for tests, which must not share state. */
export function stopMediatekPuller(): void {
  if (timer) clearInterval(timer);
  timer = null;
  lastRevision = "";
  lastScope = "";
  lastError = "";
}
