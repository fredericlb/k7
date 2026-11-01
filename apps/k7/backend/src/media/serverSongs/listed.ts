// listed.ts — which of a server's songs this machine keeps on its own: the ones the account's favorites and
// practice lists hold, read from the server itself. What reads wrong: only a copy the lists brought down
// (`kept: "lists"`) goes when they let it go; a song made here or downloaded by hand never does.
// See ../../../docs/media/songUpdates.md.

import type { Manifest } from "@studio/mediatek/manifest";
import type { SyncedSong } from "@studio/mediatek/synced";
import {
  DEVICE_FAVORITES_ROUTE,
  DEVICE_PRACTICE_ROUTE,
} from "../routes/favorites.ts";
import type { PairedServer } from "./server.ts";

/** How long one list may take: the job waits on it, and the server may be away. */
const LIST_TIMEOUT_MS = 20_000;

/** Is `path` on a list, itself or through a folder above it — the rule the pages sort by. */
export function isListed(lists: ReadonlySet<string>, path: string): boolean {
  for (let p = path; p; p = p.slice(0, Math.max(0, p.lastIndexOf("/"))))
    if (lists.has(p)) return true;
  return false;
}

/** One song of this machine's library, with its sidecar when it follows a server. */
export interface LocalSong {
  path: string;
  synced: SyncedSong | null;
}

/** What the lists ask of this machine against the server at `base`. */
export interface ListedPlan {
  /** The server's listed songs not here yet: they come down. */
  download: string[];
  /** The copies the lists brought from `base` and no longer hold: they go. */
  remove: string[];
  /** The listed songs here that follow `base`: the update check keeps them in step. */
  follow: FollowedSong[];
}

/** A song here that follows a server. */
export interface FollowedSong {
  path: string;
  synced: SyncedSong;
}

/** The plan for one server, from its lists, its song paths and this machine's songs. */
export function planListed(
  base: string,
  lists: ReadonlySet<string>,
  serverSongs: readonly string[],
  local: readonly LocalSong[],
): ListedPlan {
  const here = new Set(local.map((s) => s.path));
  const download = serverSongs.filter(
    (p) => !here.has(p) && isListed(lists, p),
  );
  const remove: string[] = [];
  const follow: FollowedSong[] = [];
  for (const { path, synced } of local) {
    if (synced?.server !== base) continue;
    if (isListed(lists, path)) follow.push({ path, synced });
    else if (synced.kept === "lists") remove.push(path);
  }
  return { download, remove, follow };
}

/** Whether every file the copy holds is one its sidecar says the server sent: anything else keeps it. */
export function onlyServerFiles(held: Manifest, synced: SyncedSong): boolean {
  const sent = new Set(synced.files.map((f) => f.path));
  return held.every((f) => sent.has(f.path));
}

/** One list of one account on the server; throws on any failure, so nothing is ever decided on a list unread. */
async function oneList(
  server: PairedServer,
  route: string,
  key: string,
): Promise<string[]> {
  const got = await fetch(`${server.base}${route}`, {
    headers: { authorization: `Bearer ${server.token}` },
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!got.ok) throw new Error(`${key}: ${got.status} ${got.statusText}`);
  const list = ((await got.json()) as Record<string, unknown>)[key];
  if (!Array.isArray(list)) throw new Error(`${key}: no list in the answer`);
  return list.filter((p): p is string => typeof p === "string");
}

/** The favorites and practice lists of every account `tokens` names on one server, as one set. */
export async function serverLists(
  tokens: readonly PairedServer[],
): Promise<Set<string>> {
  const all = await Promise.all(
    tokens.flatMap((t) => [
      oneList(t, DEVICE_FAVORITES_ROUTE, "favorites"),
      oneList(t, DEVICE_PRACTICE_ROUTE, "practice"),
    ]),
  );
  return new Set(all.flat());
}
