// cache.ts — ~/.lanes/mediatek as a MIRROR of the hosted library: what this machine holds,
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

/** Where the OWNER's description of what we hold is kept — beside the bytes, never derived
 *  from them. Under `.cache/`, so the family walk and the revision token both skip it. */
function manifestPath(family: Family): string {
  return join(cacheDir(), "manifest", `${family}.json`);
}

/** What the owner said about the files we have. Empty when we have never synced, or when
 *  the record was lost — which costs a re-fetch, not correctness. */
export function heldManifest(family: Family): Manifest {
  try {
    const v = JSON.parse(readFileSync(manifestPath(family), "utf8"));
    return Array.isArray(v) ? (v as Manifest) : [];
  } catch {
    return [];
  }
}

function rememberManifest(family: Family, m: Manifest): void {
  const p = manifestPath(family);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(m), "utf8");
}

export interface SyncReport {
  family: Family;
  fetched: string[];
  dropped: string[];
  /** Paths the owner has that could not be fetched, with why. A partial sync is a real
   *  outcome — one unreadable file must not lose the rest of a library. */
  failed: { path: string; error: string }[];
}

/**
 * Bring one family's cache in line with the owner.
 *
 * Downloads to a temp name and renames into place, so a sync interrupted halfway leaves
 * whole files rather than truncated ones — the moteur may be reading this tree.
 *
 * The manifest is written LAST and only reflects what actually landed: a crash mid-sync
 * means the next one re-fetches, which is the safe direction.
 */
export async function syncFamily(
  source: LibrarySource,
  family: Family,
): Promise<SyncReport> {
  ensureLayout();
  const want = await source.manifest(family);
  const have = heldManifest(family);
  const { fetch: todo, drop } = diff(have, want);

  const report: SyncReport = { family, fetched: [], dropped: [], failed: [] };
  const landed = new Map(have.map((e) => [e.path, e]));

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

/**
 * Is this family's cache in step with the owner?
 *
 * Compares the owner's token to the one seen at the last sync — never the local tree's own
 * revision, which is computed over local mtimes and would never match. Cheap enough to poll.
 */
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

/** Record the owner's token after a sync that left nothing failed — a partial sync must
 *  stay stale, or the missing files would never be retried. */
export function markSynced(family: Family, ownerRevision: string): void {
  const p = revisionPath(family);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, ownerRevision, "utf8");
}
