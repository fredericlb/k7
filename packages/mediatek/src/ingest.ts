// ingest.ts — push a workspace's shared folders UP into the library. It used to copy them
// into the local folder; that folder is a cache now, so anything put there by hand is
// absent from the owner's manifest and the next sync deletes it. See docs/ingest.md.

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { LibrarySink } from "./remote.ts";

/** What a workspace calls each folder, and where it lands in the library. */
const FOLDERS: { from: string; to: string }[] = [
  { from: "_modules", to: "modules" },
  { from: "_library", to: "library" },
  { from: "_ui", to: "ui" },
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

/**
 * Files a workspace holds that are the LIBRARY's to decide, not a contributor's.
 *
 * Only `_modules/config.yaml`, so far — it declares the namespace every module ref is keyed
 * by (`@mediatek/audio/reverb`). Uploading it made the last workspace pushed rename the
 * whole library, silently, for every project that inherits from it. `ensureLayout` writes
 * the library's own once and nothing else touches it. See layout.ts.
 */
function libraryOwned(rel: string): string | null {
  return rel === "modules/config.yaml"
    ? "the library declares its own namespace (see layout.ts)"
    : null;
}

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
 * Send a workspace's `_modules`, `_library` and `_ui` to the library.
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
      const owned = libraryOwned(rel);
      if (owned) {
        report.skipped.push({ path: rel, reason: owned });
        continue;
      }
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
