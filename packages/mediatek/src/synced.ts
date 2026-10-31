// synced.ts — what a device copied of one of its server's songs: the server's own manifest rows for it, kept
// in a dot-named sidecar inside the song folder, which the manifest walk, the scan and the change token skip.
// The rows are the OWNER's: a check compares the owner's next manifest with them, never a local stat. See ../docs/sync.md.

import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, ManifestEntry } from "./manifest.ts";

/** The sidecar's name inside a song's folder. */
export const SYNCED_FILE = ".synced.json";

/** A song kept in step with a server: which server, at which of its revisions, and the files it then listed. */
export interface SyncedSong {
  /** The server's http origin. */
  server: string;
  /** The server's songs revision token the rows were read at. */
  rev: string;
  files: ManifestEntry[];
}

/** The sidecar of the song folder at `abs`, or null: none, or not one this code wrote. */
export function readSynced(abs: string): SyncedSong | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(abs, SYNCED_FILE), "utf8"),
    ) as Partial<SyncedSong>;
    if (typeof raw.server !== "string" || !Array.isArray(raw.files))
      return null;
    return { server: raw.server, rev: String(raw.rev ?? ""), files: raw.files };
  } catch {
    return null;
  }
}

/** Write it through a temporary name, so a crash never leaves half a sidecar. */
export function writeSynced(abs: string, s: SyncedSong): void {
  const dest = join(abs, SYNCED_FILE);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, dest);
}

/** The song stops following its server: kept on disk, now this machine's alone. */
export function dropSynced(abs: string): void {
  rmSync(join(abs, SYNCED_FILE), { force: true });
}

/** The manifest's rows at or under `path` — a song's folder. */
export const rowsUnder = (manifest: Manifest, path: string): Manifest =>
  manifest.filter((f) => f.path === path || f.path.startsWith(`${path}/`));

const sameRow = (a: ManifestEntry, b: ManifestEntry): boolean =>
  a.bytes === b.bytes && a.mtime === b.mtime;

/** What a refresh fetches (new or changed on the server) and removes (listed before, gone from the server since). */
export function changedFiles(
  server: Manifest,
  before: Manifest,
): { fetch: Manifest; drop: string[] } {
  const was = new Map(before.map((f) => [f.path, f]));
  const now = new Set(server.map((f) => f.path));
  return {
    fetch: server.filter((f) => {
      const old = was.get(f.path);
      return !old || !sameRow(old, f);
    }),
    drop: before.filter((f) => !now.has(f.path)).map((f) => f.path),
  };
}

/** Each followed song against the server's manifest: the ones whose files changed, and the ones it no longer has. */
export function songsToRefresh(
  server: Manifest,
  songs: { path: string; synced: SyncedSong }[],
): { changed: string[]; gone: string[] } {
  const changed: string[] = [];
  const gone: string[] = [];
  for (const s of songs) {
    const rows = rowsUnder(server, s.path);
    if (!rows.length) gone.push(s.path);
    else {
      const d = changedFiles(rows, s.synced.files);
      if (d.fetch.length || d.drop.length) changed.push(s.path);
    }
  }
  return { changed, gone };
}
