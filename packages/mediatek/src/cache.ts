// cache.ts — ~/.st0/mediatek as a MIRROR of the hosted library: what this machine holds,
// what it should fetch, and the manifest it remembers to tell the two apart. Exists because
// the moteur plays from file paths and cannot open a URL. See docs/sync.md.

import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir, ensureLayout, safePath } from "./layout.ts";
import { diff, type Manifest } from "./manifest.ts";
import type { LibrarySource } from "./remote.ts";
import { bumped } from "./revision.ts";
import type { Family } from "./types.ts";

/** Where the OWNER's description of what we hold is kept, never derived from the bytes — docs/sync.md. */
function manifestPath(family: Family): string {
  return join(cacheDir(), "manifest", `${family}.json`);
}

/** What the owner said about the files we have; losing the record costs a re-fetch, not correctness. */
export function heldManifest(family: Family): Manifest {
  try {
    const v = JSON.parse(readFileSync(manifestPath(family), "utf8"));
    return Array.isArray(v) ? (v as Manifest) : [];
  } catch {
    return [];
  }
}

/** Record what the owner said about the files we now hold — evict.ts MUST rewrite it too (docs/sync.md). */
export function rememberManifest(family: Family, m: Manifest): void {
  const p = manifestPath(family);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(m), "utf8");
}

export interface SyncReport {
  family: Family;
  fetched: string[];
  dropped: string[];
  /** Paths the owner has that could not be fetched, with why — a partial sync is a real outcome. */
  failed: { path: string; error: string }[];
}

/** Bring one family's cache in line with the owner, `scope` narrowing BOTH sides of the diff — docs/sync.md. */
export async function syncFamily(
  source: LibrarySource,
  family: Family,
  scope: (path: string) => boolean = () => true,
): Promise<SyncReport> {
  ensureLayout();
  const want = (await source.manifest(family)).filter((e) => scope(e.path));
  const held = heldManifest(family);
  const have = held.filter((e) => scope(e.path));
  const { fetch: todo, drop } = diff(have, want);

  const report: SyncReport = { family, fetched: [], dropped: [], failed: [] };
  const landed = new Map(held.map((e) => [e.path, e]));

  for (const path of drop) {
    try {
      rmSync(safePath(path), { force: true });
      landed.delete(path);
      report.dropped.push(path);
    } catch (e) {
      report.failed.push({ path, error: (e as Error).message });
    }
  }

  for (const entry of todo) {
    const dest = safePath(entry.path);
    const tmp = `${dest}.part`;
    try {
      await source.download(entry.path, tmp);
      renameSync(tmp, dest);
      landed.set(entry.path, entry);
      report.fetched.push(entry.path);
    } catch (e) {
      rmSync(tmp, { force: true });
      report.failed.push({ path: entry.path, error: (e as Error).message });
    }
  }

  rememberManifest(
    family,
    [...landed.values()].sort((a, b) => a.path.localeCompare(b.path)),
  );
  if (report.fetched.length || report.dropped.length) bumped(family);
  return report;
}

/** Is this family in step with the owner? The owner's token against the one seen last sync, never ours. */
export async function isStale(
  source: LibrarySource,
  family: Family,
): Promise<boolean> {
  const seen = seenRevision(family);
  const theirs = (await source.revisions())[family];
  return seen !== theirs;
}

function revisionPath(family: Family): string {
  return join(cacheDir(), "manifest", `${family}.rev`);
}

/** The owner's token as of the last successful sync, or "" when never synced. */
export function seenRevision(family: Family): string {
  try {
    return readFileSync(revisionPath(family), "utf8");
  } catch {
    return "";
  }
}

/** Record the owner's token after a sync that failed nothing — a partial sync must stay stale. */
export function markSynced(family: Family, ownerRevision: string): void {
  const p = revisionPath(family);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, ownerRevision, "utf8");
}
