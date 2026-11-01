// download.ts — entries copied from the paired server into this machine's library, on one manifest. A song
// that FOLLOWS its server keeps the server's rows in its sidecar, so its next copy fetches only what changed
// and removes what the server removed. One copy of a path at a time. See packages/mediatek/docs/serverCopy.md.

import { rmdirSync, rmSync } from "node:fs";
import { dirname, sep } from "node:path";
import { familyDir, safePath } from "@studio/mediatek/layout";
import { type Manifest, manifestUnder } from "@studio/mediatek/manifest";
import { RemoteError, remoteLibrary } from "@studio/mediatek/remote";
import { bumped } from "@studio/mediatek/revision";
import {
  changedFiles,
  readSynced,
  rowsUnder,
  type SyncedSong,
  writeSynced,
} from "@studio/mediatek/synced";
import type { Family } from "@studio/mediatek/types";
import { onlyServerFiles } from "./listed.ts";
import { noteReach } from "./reach.ts";
import {
  DEVICE_LIBRARY_ROUTE,
  type PairedServer,
  serverManifest,
} from "./server.ts";

/** The copy of each path under way, so a page's download and the update check never write one song twice at once. */
const copying = new Map<string, Promise<number>>();

function oneAtATime(key: string, run: () => Promise<number>): Promise<number> {
  const before = copying.get(key) ?? Promise.resolve(0);
  const next = before.catch(() => 0).then(run);
  copying.set(key, next);
  const done = () => {
    if (copying.get(key) === next) copying.delete(key);
  };
  next.then(done, done);
  return next;
}

export interface DownloadOptions {
  /** Record the server's rows in the song's sidecar: the update check then keeps it in step. */
  follow?: boolean;
  /** A manifest already read, by a caller copying several songs off one. */
  manifest?: { rev: string; files: Manifest };
  /** Who asked: the lists mark a new copy theirs, a hand clears that mark; absent, a refresh keeps it as it was. */
  by?: "lists" | "hand";
}

/** The sidecar's `kept` after a copy: `before` being the song's sidecar, if it had one. */
export function keptAfter(
  by: DownloadOptions["by"],
  before: SyncedSong | null,
): "lists" | undefined {
  if (by === "hand") return undefined;
  if (by === "lists") return before ? before.kept : "lists";
  return before?.kept;
}

/** Copy each entry (a sample's file, a song's folder) from `server` here; how many files moved, and what it lacks. */
export async function downloadEntries(
  server: PairedServer,
  family: Family,
  paths: string[],
  opts: DownloadOptions = {},
): Promise<{ files: number; missing: string[] }> {
  const source = remoteLibrary({ ...server, route: DEVICE_LIBRARY_ROUTE });
  let manifest = opts.manifest;
  if (!manifest)
    try {
      manifest = await serverManifest(server, family);
      noteReach(server.base, true);
    } catch (e) {
      noteReach(server.base, false);
      throw e;
    }
  const { rev, files: all } = manifest;
  let files = 0;
  const missing: string[] = [];
  for (const path of paths) {
    const rows = rowsUnder(all, path);
    if (!rows.length) {
      missing.push(path);
      continue;
    }
    files += await oneAtATime(`${family} ${path}`, async () => {
      const song = family === "songs" ? safePath(path) : null;
      const before = song ? readSynced(song) : null;
      const prior = before?.server === server.base ? before.files : null;
      const { fetch, drop } = prior
        ? changedFiles(rows, prior)
        : { fetch: rows, drop: [] };
      try {
        for (const f of fetch) await source.download(f.path, safePath(f.path));
      } catch (e) {
        // remote.ts words a transport failure `mediatek GET <url>`; a refusal is the server answering.
        if (e instanceof RemoteError && e.message.startsWith("mediatek GET"))
          noteReach(server.base, false);
        throw e;
      }
      for (const p of drop) rmSync(safePath(p), { force: true });
      if (song && (opts.follow || prior)) {
        const kept = keptAfter(opts.by, prior ? before : null);
        writeSynced(song, {
          server: server.base,
          rev,
          files: rows,
          ...(kept ? { kept } : {}),
        });
      }
      return fetch.length + drop.length;
    });
  }
  if (files) bumped(family);
  return { files, missing };
}

/** Delete the copy of the song at `path` the lists kept from `base`, if it still is one; whether it went. */
export async function removeKeptCopy(
  base: string,
  path: string,
): Promise<boolean> {
  const gone = await oneAtATime(`songs ${path}`, async () => {
    const abs = safePath(path);
    const synced = readSynced(abs);
    // Read again under the lock: a hand may have downloaded it, or the server lost it, since the plan.
    if (synced?.server !== base || synced.kept !== "lists") return 0;
    if (!onlyServerFiles(await manifestUnder(abs), synced)) return 0;
    rmSync(abs, { recursive: true, force: true });
    pruneEmpty(dirname(abs), familyDir("songs"));
    return 1;
  });
  if (gone) bumped("songs");
  return gone > 0;
}

/** Remove `dir` and the folders above it while empty, up to `stop` excluded: an album left with no song goes. */
function pruneEmpty(dir: string, stop: string): void {
  for (let d = dir; d.startsWith(`${stop}${sep}`); d = dirname(d))
    try {
      rmdirSync(d);
    } catch {
      return;
    }
}
