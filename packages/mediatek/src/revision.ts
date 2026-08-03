// revision.ts — a cheap token per family that CHANGES when that family's files do, so a
// surface polls it instead of the listing. Modelled on file-service's workspace revision()
// — count plus newest mtime, deliberately not a content hash. See docs/index.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { familyDir, RECORDINGS_DIR, recordingsDir } from "./layout.ts";
import { FAMILIES, type Family } from "./types.ts";

/** What can carry a token: the three families, plus the raw capture zone — which is not a
 *  family but moves, and has a surface polling it. See docs/recordings.md. */
export type RevisionKey = Family | typeof RECORDINGS_DIR;

/** Derived, hidden or per-machine junk: none of it is the library's content. */
function skip(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

/** Count + newest mtime under a directory. Unreadable dirs count as empty rather than
 *  failing the poll — a permission problem must not look like an emptied library. */
function walk(dir: string): { count: number; newest: number } {
  let count = 0;
  let newest = 0;
  const rec = (abs: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip(e.name)) continue;
      const p = join(abs, e.name);
      if (e.isDirectory()) {
        rec(p);
        continue;
      }
      count++;
      try {
        const m = statSync(p).mtimeMs;
        if (m > newest) newest = m;
      } catch {
        /* raced away between readdir and stat — the next poll sees it */
      }
    }
  };
  rec(dir);
  return { count, newest };
}

/**
 * Our OWN writes, per family.
 *
 * The walk alone cannot see a change that preserves both its ingredients — files replaced
 * in place inside one filesystem-timestamp tick, none added or removed. That is exactly
 * the shape of "import a library, then list it", so a write we caused has to say so
 * rather than wait to be noticed. Same two ingredients as file-service's workspace
 * revision, and for the same reason.
 */
const mutations: Partial<Record<RevisionKey, number>> = {};

/** Record that this family or zone was written to. Called by whatever did the writing. */
export function bumped(key: RevisionKey): void {
  mutations[key] = (mutations[key] ?? 0) + 1;
}

/**
 * One family's change token.
 *
 * PER FAMILY, not one for the whole library: importing a morceau must not invalidate the
 * module list, and the families move at wildly different rates — a sample pack is dropped
 * in once, modules are edited all afternoon.
 */
export function familyRevision(family: Family): string {
  const { count, newest } = walk(familyDir(family));
  return `${mutations[family] ?? 0}:${count}:${newest}`;
}

/** The capture zone's own token. It used to ride on `morceaux`, which cost that family a
 *  pointless refetch on every capture; a zone at the root answers for itself. */
export function recordingsRevision(): string {
  const { count, newest } = walk(recordingsDir());
  return `${mutations[RECORDINGS_DIR] ?? 0}:${count}:${newest}`;
}

/** Every token at once — what a listing is stamped with. The zone is in here beside the
 *  families because one poll drives the whole screen, tabs included. */
export function revisions(): Record<RevisionKey, string> {
  return {
    ...(Object.fromEntries(
      FAMILIES.map((f) => [f, familyRevision(f)]),
    ) as Record<Family, string>),
    [RECORDINGS_DIR]: recordingsRevision(),
  };
}
