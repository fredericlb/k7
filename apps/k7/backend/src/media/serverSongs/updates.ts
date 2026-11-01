// updates.ts — the songs the account's lists hold, kept on this machine and in step by this backend alone: at start,
// every half hour and when a list changes, the lists are read from the server, a listed song not here comes down, a
// copy the lists let go is deleted, and the listed copies are checked against the server's manifest. A song the server
// lost is kept here and stops following. Nothing is decided on a list unread. See ../../../docs/media/songUpdates.md.

import { listFamilyFresh } from "@studio/mediatek/catalogue";
import { safePath } from "@studio/mediatek/layout";
import {
  dropSynced,
  markLeft,
  readSynced,
  songsToRefresh,
  writeSynced,
} from "@studio/mediatek/synced";
import type { FamilyListing } from "@studio/mediatek/types";
import { downloadEntries, removeKeptCopy } from "./download.ts";
import { beginJob as begin } from "./jobs.ts";
import {
  type FollowedSong,
  type LocalSong,
  planListed,
  serverLists,
} from "./listed.ts";
import { noteReach } from "./reach.ts";
import { deviceGet, type PairedServer, serverManifest } from "./server.ts";

/** How often the listed songs are checked once the first check is done. */
export const CHECK_EVERY_MS = 30 * 60_000;
/** After a start, so the first pages and the library's own boot go first. */
const FIRST_CHECK_MS = 15_000;
/** The server's song listing, a few hundred entries from a busy origin. */
const LISTING_MS = 30_000;

let runs = 0;

/** Every song of this machine's library, with its sidecar when it has one. */
async function localSongs(): Promise<LocalSong[]> {
  return (await listFamilyFresh("songs")).entries.map((e) => ({
    path: e.path,
    synced: readSynced(safePath(e.path)),
  }));
}

/** One server's listed songs brought in step; how many came down again and how many it no longer has. */
async function checkServer(
  server: PairedServer,
  followed: FollowedSong[],
  run: number,
): Promise<{ updated: number; gone: number }> {
  const { revisions } = await deviceGet<{ revisions: Record<string, string> }>(
    server,
    "/revision",
    30_000,
  );
  noteReach(server.base, true);
  // Every sidecar read at the server's current token: nothing moved there since.
  if (followed.every((s) => s.synced.rev === revisions.songs))
    return { updated: 0, gone: 0 };
  const manifest = await serverManifest(server, "songs");
  const { changed, gone } = songsToRefresh(manifest.files, followed);
  // Marked, not only dropped: the upload must not send back a song its server removed.
  for (const path of gone) {
    dropSynced(safePath(path));
    markLeft(safePath(path), server.base);
  }
  const moved = new Set([...changed, ...gone]);
  // The unchanged ones are stamped with the new token, so the next check stops at the revision.
  for (const s of followed)
    if (!moved.has(s.path))
      writeSynced(safePath(s.path), { ...s.synced, rev: manifest.rev });
  let updated = 0;
  for (const path of changed)
    if (await copySong(server, path, run, { manifest })) updated++;
  return { updated, gone: gone.length };
}

/** One song copied down as a job of its own; whether it landed. */
async function copySong(
  server: PairedServer,
  path: string,
  run: number,
  opts: Parameters<typeof downloadEntries>[3],
): Promise<boolean> {
  const end = begin({
    key: `song:${run}:${path}`,
    kind: "song",
    path,
    phase: "running",
  });
  try {
    await downloadEntries(server, "songs", [path], { follow: true, ...opts });
    end({});
    return true;
  } catch (e) {
    end({ phase: "failed", error: (e as Error).message });
    return false;
  }
}

/** The listed songs not here come down, the copies the lists let go are deleted; the listed ones here are returned. */
async function keepListed(
  tokens: PairedServer[],
  local: LocalSong[],
  run: number,
): Promise<FollowedSong[]> {
  const [server] = tokens as [PairedServer];
  // Both read, or nothing is done: a list that failed is never taken for an empty one.
  const [lists, listing] = await Promise.all([
    serverLists(tokens),
    deviceGet<FamilyListing>(server, "/list?family=songs", LISTING_MS),
  ]);
  noteReach(server.base, true);
  const plan = planListed(
    server.base,
    lists,
    listing.entries.map((e) => e.path),
    local,
  );
  for (const path of plan.remove) await removeKeptCopy(server.base, path);
  if (plan.download.length) {
    const manifest = await serverManifest(server, "songs");
    for (const path of plan.download)
      await copySong(server, path, run, { manifest, by: "lists" });
  }
  return plan.follow;
}

/** The paired accounts by server: one machine may hold several accounts' links to one origin. */
function byServer(servers: PairedServer[]): Map<string, PairedServer[]> {
  const by = new Map<string, PairedServer[]>();
  for (const s of servers) by.set(s.base, [...(by.get(s.base) ?? []), s]);
  return by;
}

/** What a run does beyond keeping the lists' songs: the update check, which the periodic run adds. */
interface RunOptions {
  updates: boolean;
}

/** One run over every paired server, its update check listed as a job when there is something to check. */
async function runOnce(
  servers: () => PairedServer[],
  { updates }: RunOptions,
): Promise<void> {
  const by = byServer(servers());
  // Signed out of every server: no list to read, nothing kept, nothing deleted.
  if (!by.size) return;
  const run = ++runs;
  const local = await localSongs();
  let end: ReturnType<typeof begin> | null = null;
  const job = () => {
    end ??= begin({ key: `check:${run}`, kind: "check", phase: "running" });
  };
  let updated = 0;
  let gone = 0;
  const errors: string[] = [];
  for (const [base, tokens] of by) {
    const follows = local.some((s) => s.synced?.server === base);
    try {
      const listed = await keepListed(tokens, local, run);
      if (!updates || !listed.length) continue;
      job();
      const got = await checkServer(tokens[0] as PairedServer, listed, run);
      updated += got.updated;
      gone += got.gone;
    } catch (e) {
      noteReach(base, false);
      // A failure is said where a check would have run: a song here follows that server.
      if (!updates || !follows) continue;
      job();
      errors.push(`${new URL(base).host}: ${(e as Error).message}`);
    }
  }
  (end as ReturnType<typeof begin> | null)?.(
    errors.length
      ? { phase: "failed", error: errors.join(" · "), updated, gone }
      : { updated, gone },
  );
}

let checking: Promise<void> | null = null;
let again: RunOptions | null = null;

/** One run; a call while one runs is run once more after it, so a list changed meanwhile is not missed. */
export function checkSongUpdates(
  servers: () => PairedServer[],
  opts: RunOptions = { updates: true },
): Promise<void> {
  if (checking) {
    again = { updates: opts.updates || !!again?.updates };
    return checking;
  }
  checking = runOnce(servers, opts).finally(() => {
    checking = null;
    const next = again;
    again = null;
    if (next)
      void checkSongUpdates(servers, next).catch((e: Error) =>
        console.error(`listed songs: ${e.message}`),
      );
  });
  return checking;
}

/** A list changed: its songs come down, or go, now; the update check waits for its own time. */
export const keepListedSongs = (servers: () => PairedServer[]): Promise<void> =>
  checkSongUpdates(servers, { updates: false });

/** At start (shortly after) and every CHECK_EVERY_MS, for as long as the process runs. */
export function startSongUpdates(servers: () => PairedServer[]): () => void {
  const check = () =>
    void checkSongUpdates(servers).catch((e: Error) =>
      console.error(`song updates: ${e.message}`),
    );
  const first = setTimeout(check, FIRST_CHECK_MS);
  const every = setInterval(check, CHECK_EVERY_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
