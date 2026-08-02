// revision.ts — a cheap token per family that CHANGES when that family's files do, so a
// surface polls it instead of the listing. Modelled on file-service's workspace revision()
// — count plus newest mtime, deliberately not a content hash. See docs/index.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { familyDir } from "./layout.ts";
import { FAMILIES, type Family } from "./types.ts";

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
 * One family's change token.
 *
 * PER FAMILY, not one for the whole library: importing a morceau must not invalidate the
 * module list, and the families move at wildly different rates — a sample pack is dropped
 * in once, modules are edited all afternoon.
 *
 * There is no mutation counter yet, unlike workspace's: nothing writes through this
 * service. Add one the moment ingest lands, or a write followed by a same-millisecond
 * read will serve the stale listing.
 */
export function familyRevision(family: Family): string {
  const { count, newest } = walk(familyDir(family));
  return `${count}:${newest}`;
}

/** Every family's token at once — what a listing is stamped with. */
export function revisions(): Record<Family, string> {
  return Object.fromEntries(
    FAMILIES.map((f) => [f, familyRevision(f)]),
  ) as Record<Family, string>;
}
