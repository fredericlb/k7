// mediatekPull.ts — keeps this machine's médiathèque cache in step with the hosted library,
// for what the open projects actually name: the songs the playlist a desk points at lists.
// Unattended, so a song added to the set list in st0 lands here on its own before the gig.
// See docs/mediatekPull.md.

import { syncFamily } from "@studio/mediatek/cache";
import { remoteLibrary } from "@studio/mediatek/remote";
import type { Family } from "@studio/mediatek/types";
import {
  mediatekPathPrefix,
  mediatekRefs,
  mediatekSongRefs,
} from "@studio/song/mediatekRefs";
import { songPathPrefix } from "@studio/song-schema/songRef";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";
import { liveWorkspaces } from "./workspaces.ts";

/** How often the owner's change token is asked for; cheap on the server, but a network call per tick. */
const EVERY_MS = 60_000;
/** The first pull, delayed so a cold boot isn't competing with the engine coming up. */
const FIRST_MS = 5_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** The owner's token and the scope of the last clean sync, per family and in memory — docs/mediatekPull.md. */
const seen = new Map<Family, { revision: string; scope: string }>();
/** The last error reported, so a library that is down says so once and not every minute. */
let lastError = "";

/** The only family this loop fetches; a git checkout must never be one — see docs/mediatekPull.md. */
const PULLED = ["songs"] as const;

/** The library-relative folders the open projects reach for, sorted so the signature is stable. */
function scope(): Record<(typeof PULLED)[number], string[]> {
  const songs = new Set<string>();
  for (const ws of liveWorkspaces()) {
    const dir = ws.activeProjectPath();
    if (!dir) continue;
    // Songs only: the modules a project names come with the workspace, a checkout rather than a fetch.
    for (const ref of mediatekSongRefs(dir, ws.root))
      songs.add(songPathPrefix(ref));
  }
  return { songs: [...songs].sort() };
}

/** One pass: ask what the library is at, and fetch what moved within the scope. Never throws. */
export async function pullOnce(): Promise<void> {
  const base = mediatekBase();
  if (!base || running) return;
  const prefixes = scope();
  // Nothing open names the library: no fetch, and no token recorded either (docs/mediatekPull.md).
  if (!PULLED.some((f) => prefixes[f].length)) return;

  running = true;
  try {
    const source = remoteLibrary({ base, token: mediatekToken() ?? undefined });
    const revisions = await source.revisions();
    let landed = false;
    for (const family of PULLED) {
      const within = prefixes[family];
      if (!within.length) continue;
      const revision = revisions[family] ?? "";
      const signature = within.join("|");
      const before = seen.get(family);
      // Two reasons to sync, and the scope is the one a change token cannot see.
      if (before?.revision === revision && before.scope === signature) continue;

      const report = await syncFamily(source, family, (p) =>
        within.some((prefix) => p.startsWith(prefix)),
      );
      if (report.fetched.length || report.dropped.length) {
        landed = true;
        console.log(
          `   mediatek ${family}: ${report.fetched.length} file(s) in, ${report.dropped.length} out`,
        );
      }
      // A partial sync stays stale on purpose: the files that failed are retried next tick.
      if (!report.failed.length)
        seen.set(family, { revision, scope: signature });
    }
    // The compiled doc is memoised per workspace and only our own writes invalidate it.
    if (landed) for (const ws of liveWorkspaces()) ws.invalidateProjectDoc();
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

/** Fetch a WHOLE family, ignoring the scope — what the module bench needs (docs/mediatekPull.md). */
export async function syncMediatekFamily(family: Family): Promise<void> {
  const base = mediatekBase();
  if (!base) return;
  try {
    const source = remoteLibrary({ base, token: mediatekToken() ?? undefined });
    const report = await syncFamily(source, family, () => true);
    if (report.fetched.length || report.dropped.length) {
      console.log(
        `   mediatek ${family} (full): ${report.fetched.length} file(s) in, ${report.dropped.length} out`,
      );
      for (const ws of liveWorkspaces()) ws.invalidateProjectDoc();
    }
    // The scoped loop's memo records a SCOPE and this pass had none, so drop it and let it re-decide.
    seen.delete(family);
  } catch (e) {
    console.warn(`   mediatek ${family} (full): ${(e as Error).message}`);
  }
}

/** STOPPED: it downloaded each scoped file onto itself and zeroed three songs — docs/mediatekPull.md. */
export function startMediatekPuller(): void {
  return;
}

/** Stop the loop and forget what was seen — for tests, which must not share state. */
export function stopMediatekPuller(): void {
  if (timer) clearInterval(timer);
  timer = null;
  seen.clear();
  lastError = "";
}
