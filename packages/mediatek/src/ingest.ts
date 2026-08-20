// ingest.ts — push a workspace's shared folders UP into the library. It used to copy them
// into the local folder; that folder is a cache now, so anything put there by hand is
// absent from the owner's manifest and the next sync deletes it. See docs/ingest.md.

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { LibrarySink } from "./remote.ts";

/** What a workspace calls each folder, and where it lands in the library.
 *
 *  `_modules` → `modules/` was the first entry and is gone with the family: a workspace's own
 *  modules go up to the account's LIBRARY REPOSITORY now, through st0 and a commit, not to this
 *  volume. Pushing them here would have made a second copy nobody reads. */
const FOLDERS: { from: string; to: string }[] = [
  { from: "_library", to: "library" },
];

export interface ImportReport {
  /** Library-relative POSIX paths that were sent. */
  uploaded: string[];
  /** Paths that failed, with why — a partial push is a real outcome, not a rollback. */
  failed: { path: string; error: string }[];
  /** Workspace folders that weren't there — not an error, most workspaces have some. */
  absent: string[];
  /** Files deliberately not sent, with why. Reported rather than silent: "it uploaded"
   *  and "it uploaded everything" are different claims, and only one of them is true. */
  skipped: { path: string; reason: string }[];
}

// `libraryOwned()` stood here: one rule, refusing to send a workspace's
// `_modules/config.yaml` up, because that file declared the namespace every ref is keyed by
// and belonged to the library rather than to a contributor. Both the file and the folder it
// sat in are gone with the `modules` family, so there is nothing left for it to guard.

function entries(abs: string): Dirent[] {
  try {
    return readdirSync(abs, { withFileTypes: true }).filter(
      (e) => !e.name.startsWith("."),
    );
  } catch {
    return [];
  }
}

const exists = (p: string): boolean => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

/** Every file under a folder, as (absolute, library-relative) pairs. */
function filesUnder(src: string, toPrefix: string): [string, string][] {
  const out: [string, string][] = [];
  const walk = (abs: string): void => {
    for (const e of entries(abs)) {
      const p = join(abs, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      const rel = relative(src, p).split(sep).join("/");
      out.push([p, `${toPrefix}/${rel}`]);
    }
  };
  walk(src);
  return out;
}

/**
 * Send a workspace's `_modules` and `_library` to the library.
 *
 * No longer additive, and it cannot be: the library is somewhere else, and asking it "do
 * you already have this?" per file would double the round trips to answer a question the
 * owner is better placed to decide. A PUT replaces. What protects a shared module is not
 * this function refusing — it is that pushing a workspace up is a deliberate act aimed at
 * a named workspace, and that the library keeps its own history elsewhere if it wants one.
 *
 * `wsRoot` is the WORKSPACE — the folder holding the projects and their shared folders.
 */
export async function uploadWorkspace(
  sink: LibrarySink,
  wsRoot: string,
): Promise<ImportReport> {
  const report: ImportReport = {
    uploaded: [],
    failed: [],
    absent: [],
    skipped: [],
  };

  for (const f of FOLDERS) {
    const src = join(wsRoot, f.from);
    if (!exists(src)) {
      report.absent.push(f.from);
      continue;
    }
    for (const [abs, rel] of filesUnder(src, f.to)) {
      try {
        await sink.put(rel, readFileSync(abs));
        report.uploaded.push(rel);
      } catch (e) {
        report.failed.push({ path: rel, error: (e as Error).message });
      }
    }
  }
  return report;
}
