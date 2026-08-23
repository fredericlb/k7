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
import { songPathPrefix } from "@studio/song/songRef";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";
import { liveWorkspaces } from "./workspaces.ts";

/** How often the owner's change token is asked for. Cheap on the server — a walk it already
 *  caches — but it is a network call per tick, so not per second either. */
const EVERY_MS = 60_000;
/** The first pull, delayed so a cold boot isn't competing with the engine coming up. */
const FIRST_MS = 5_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** The owner's token and the scope, as of the last sync that landed cleanly, PER FAMILY. Both
 *  in MEMORY: `markSynced` records "this cache is in step with the owner", which a scoped sync
 *  has no right to claim — losing this on restart costs one manifest fetch and no downloads.
 *  Per family because the two move independently: editing a module must not re-diff a
 *  library of masters, and adding a song to a set must not re-diff the modules. */
const seen = new Map<Family, { revision: string; scope: string }>();
/** The last error reported, so a library that is down says so once and not every minute. */
let lastError = "";

/**
 * The families this loop still fetches.
 *
 * `modules` and `chains` are GONE from it: they live in the account's library repository now,
 * mounted in each workspace as a git submodule (`@studio/song`'s docs/sharedFolders.md), and a
 * folder that git owns must have exactly one writer. `syncFamily` deletes whatever the owner's
 * manifest does not list, so leaving it pointed at a checkout would have it quietly removing
 * files somebody committed — the same reason writing into the cache by hand was already a
 * mistake (see routes/mediatek.ts).
 *
 * What is left is what the hosted médiathèque still owns and a machine still plays from disk:
 * the songs a set's PLAYLIST lists. Samples are fetched per clip, not by this loop.
 */
const PULLED = ["songs"] as const;

/**
 * The library-relative folders the open projects reach for, sorted so the signature is stable.
 *
 * Two vocabularies, kept apart to the last step: a MODULE ref omits its family
 * (`@st0/audio/x` → `modules/audio/x/`) and a SONG ref carries one
 * (`@st0/songs/a/b/c` → `songs/a/b/c/`), so each is mapped by its own function and only
 * the results are merged. The songs are a set's PLAYLIST, and they are the reason this loop
 * matters at all off the desk: the machine that plays them opens file paths, so every song in
 * the set has to be on its disk before the gig.
 *
 * The workspace ROOT goes down with the project directory, which it did not have to before: a
 * playlist lives beside `_modules` at the top of the repository rather than inside the project
 * (`@studio/song/docs/playlists.md`), so answering "what does this set name" now needs both
 * halves. `mediatekSongRefs` is where the two meet, and the only place they do.
 */
function scope(): Record<(typeof PULLED)[number], string[]> {
  const songs = new Set<string>();
  for (const ws of liveWorkspaces()) {
    const dir = ws.activeProjectPath();
    if (!dir) continue;
    // The modules a project names used to be gathered here too. They come with the workspace
    // now — a checkout, not a fetch — so there is nothing to scope and nothing to diff.
    for (const ref of mediatekSongRefs(dir, ws.root))
      songs.add(songPathPrefix(ref));
  }
  return { songs: [...songs].sort() };
}

/**
 * One pass: ask what the library is at, and fetch what moved within the scope.
 *
 * Exported for the tests and for a caller that wants it now; the loop below is the normal
 * driver. Never throws — a hosted library that is unreachable must cost the update, not the
 * file service.
 */
export async function pullOnce(): Promise<void> {
  const base = mediatekBase();
  if (!base || running) return;
  const prefixes = scope();
  // Nothing open names the library: no fetch, and no token recorded either, or the first song
  // that does would be told everything is already in step.
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
      // Two reasons to sync, and the scope is the one a change token cannot see: a project
      // that starts naming something the cache never held moved nothing on the server.
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
    // The compiled doc is memoised per workspace and only our own writes invalidate it, so
    // without this a module that just landed would sit on disk behind yesterday's compile.
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

/**
 * Fetch a WHOLE family, ignoring the scope — what the module bench needs and nothing else does.
 *
 * `pullOnce` above fetches only what the open projects name, which is the right default and the
 * reason this cache stays small. The bench names nothing: its whole content is the catalogue, so
 * the scoped pull would leave it holding whatever happened to be cached for other songs.
 *
 * It deliberately does NOT record a revision. `markSynced`'s claim is "this cache is in step with
 * the owner", and that is not true for the songs the scoped loop pulls — letting it keep its own
 * bookkeeping is cheaper than teaching it about a second kind of pass.
 *
 * Never throws, same as `pullOnce`: an unreachable library must cost the refresh, not the open.
 */
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
    // The scoped loop's memo would now be a lie in the other direction — it records a SCOPE
    // alongside the revision, and this pass had none. Dropping the entry makes its next tick
    // re-decide rather than skip.
    seen.delete(family);
  } catch (e) {
    console.warn(`   mediatek ${family} (full): ${(e as Error).message}`);
  }
}

/**
 * Start the loop. A no-op with no hosted library configured — the local folder is then not a
 * cache of anything, which is a working state (see fileServiceProcess.ts).
 *
 * STOPPED, and this guard is a stopgap rather than the design: the médiathèque cache is being
 * removed (the stem cut moves to pl8, which already holds the bytes), and until it goes this
 * loop must not run.
 *
 * What it did on this machine, measured 2026-08-22: `STUDIO_MEDIATEK` for pl8's backend is
 * `~/.studio/mediatek` — the very directory this cache writes into (`env.yaml`) — so every tick
 * downloaded each scoped file ONTO ITSELF and renamed the copy over the original while the
 * server was still serving it. Three songs came back as pure zeros, 3.4 MB and 37 MB of `0x00`,
 * and no other copy of them existed on the machine.
 *
 * It could not settle, either: `syncFamily` records the manifest entry's mtime, and its own
 * rename gives the file a NEW one, so the next diff always mismatched. Nine files rewritten
 * every sixty seconds, indefinitely.
 */
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
