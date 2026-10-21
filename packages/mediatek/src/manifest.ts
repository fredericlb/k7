// manifest.ts — one family's files as (path, size, mtime), the description a library serves so
// another one can copy from it (docs/serverCopy.md). The mtime is the OWNER's, never a local stat.

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { familyDir, mediatekDir } from "./layout.ts";
import { withoutDerived } from "./media.ts";
import { mapLimit } from "./pool.ts";
import { familyRevision } from "./revision.ts";
import type { Family } from "./types.ts";

/** One file, as the side that owns it describes it. */
export interface ManifestEntry {
  /** Mediatek-relative POSIX path — the same id space entries use. */
  path: string;
  bytes: number;
  /** ms since epoch, AS REPORTED BY THE OWNER. Never compared against a local stat. */
  mtime: number;
}

export type Manifest = ManifestEntry[];

/** Every file under `root`, level by level so the folders read at once stay bounded. */
async function walk(root: string): Promise<Manifest> {
  const files: string[] = [];
  let level = [root];
  while (level.length) {
    const listed = await mapLimit(level, (d) =>
      readdir(d, { withFileTypes: true }).catch((): Dirent[] => []),
    );
    level = [];
    // A FLAC's derived copy never syncs: a machine's mirror plays the FLAC (docs/derived.md).
    for (const entries of listed)
      for (const e of withoutDerived(entries)) {
        if (e.name.startsWith(".")) continue; // .cache and friends are derived
        const abs = join(e.parentPath, e.name);
        if (e.isDirectory()) level.push(abs);
        else files.push(abs);
      }
  }
  const out = await mapLimit(files, async (abs) => {
    try {
      const s = await stat(abs);
      return {
        path: relative(mediatekDir(), abs).split(sep).join("/"),
        bytes: s.size,
        mtime: s.mtimeMs,
      };
    } catch {
      return null; // raced away between readdir and stat
    }
  });
  return out.filter((e): e is ManifestEntry => e !== null);
}

/** Every file in a FAMILY, sorted; the capture zone is no family, so it never syncs (docs/recordings.md). */
export async function manifest(family: Family): Promise<Manifest> {
  const out = await walk(familyDir(family));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// Keyed by the family's DIRECTORY, so a root that changed under us is never answered from the old one.
const held = new Map<string, { rev: string; files: Promise<Manifest> }>();

/** `manifest`, walked once per family revision and shared by every caller asking at that revision. */
export function manifestAt(family: Family): {
  rev: string;
  files: Promise<Manifest>;
} {
  const key = familyDir(family);
  const rev = familyRevision(family);
  const have = held.get(key);
  if (have && have.rev === rev) return have;
  const files = manifest(family);
  const next = { rev, files };
  held.set(key, next);
  // A failed walk is not kept: the next caller walks again.
  files.catch(() => {
    if (held.get(key) === next) held.delete(key);
  });
  return next;
}
