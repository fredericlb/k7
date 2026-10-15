// manifest.ts — one family's files as (path, size, mtime), which is what a cache diffs
// against to know what to fetch. Runs on BOTH sides: the server describes its volume, the
// cache remembers what the server said. See docs/sync.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { familyDir, mediatekDir } from "./layout.ts";
import { withoutDerived } from "./media.ts";
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

function walk(dir: string, out: Manifest): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable corner — fewer entries, never a throw
  }
  // A FLAC's derived MP3 never syncs: a machine's mirror plays the FLAC (docs/derivedMp3.md).
  for (const e of withoutDerived(entries)) {
    if (e.name.startsWith(".")) continue; // .cache and friends are derived
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      walk(abs, out);
      continue;
    }
    try {
      const s = statSync(abs);
      out.push({
        path: relative(mediatekDir(), abs).split(sep).join("/"),
        bytes: s.size,
        mtime: s.mtimeMs,
      });
    } catch {
      /* raced away between readdir and stat */
    }
  }
}

/** Every file in a FAMILY, sorted; the capture zone is no family, so it never syncs (docs/recordings.md). */
export function manifest(family: Family): Manifest {
  const out: Manifest = [];
  walk(familyDir(family), out);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** What a cache holding `have` must fetch and drop to match `want`, both being the OWNER's description — docs/sync.md. */
export function diff(
  have: Manifest,
  want: Manifest,
): { fetch: ManifestEntry[]; drop: string[] } {
  const mine = new Map(have.map((e) => [e.path, e]));
  const fetch: ManifestEntry[] = [];
  for (const w of want) {
    const h = mine.get(w.path);
    if (!h || h.bytes !== w.bytes || h.mtime !== w.mtime) fetch.push(w);
    mine.delete(w.path);
  }
  return { fetch, drop: [...mine.keys()] };
}
