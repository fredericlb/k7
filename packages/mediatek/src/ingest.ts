// ingest.ts — copy a workspace's shared folders INTO the media library. The first thing
// that writes here, and deliberately the least destructive thing that could work: it adds
// what is missing and never replaces what is there. See docs/ingest.md.

import {
  copyFileSync,
  type Dirent,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import {
  cacheDir,
  ensureLayout,
  familyDir,
  libraryDir,
  mediatekDir,
  uiDir,
} from "./layout.ts";
import { bumped } from "./revision.ts";
import type { Family } from "./types.ts";

/** What a workspace calls each folder, and where it lands in the library. */
const FOLDERS: { from: string; to: () => string; family: Family | null }[] = [
  { from: "_modules", to: () => familyDir("modules"), family: "modules" },
  { from: "_library", to: () => libraryDir(), family: null },
  { from: "_ui", to: () => uiDir(), family: "modules" },
];

export interface ImportReport {
  /** Library-relative POSIX paths that were created. */
  copied: string[];
  /** Library-relative POSIX paths already present, left exactly as they were. */
  skipped: string[];
  /** Workspace folders that weren't there — not an error, most workspaces have some. */
  absent: string[];
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

/**
 * Copy one tree, file by file, never over an existing file.
 *
 * Not `cpSync(..., { force: false })`: that would silently do the same thing but tell us
 * nothing, and "what did this actually change" is the whole answer an import owes its
 * caller — it is what makes the operation undoable by hand.
 */
function copyTree(src: string, dest: string, report: ImportReport): void {
  for (const e of entries(src)) {
    const from = join(src, e.name);
    const to = join(dest, e.name);
    if (e.isDirectory()) {
      copyTree(from, to, report);
      continue;
    }
    const rel = relative(mediatekDir(), to).split(sep).join("/");
    if (exists(to)) {
      report.skipped.push(rel);
      continue;
    }
    mkdirSync(dest, { recursive: true });
    copyFileSync(from, to);
    report.copied.push(rel);
  }
}

/**
 * Import a workspace's `_modules`, `_library` and `_ui` into the media library.
 *
 * ADDITIVE, and that is the whole policy. A module already in the library is left alone
 * and reported as skipped, because the library is shared: replacing one would change what
 * every project that inherits it plays, from an action whose subject was a different
 * workspace. Overwriting is a decision someone has to make per module, and there is no
 * per-module answer here to make it with.
 *
 * `wsRoot` is the WORKSPACE, the folder holding the projects and their shared folders —
 * not a project.
 */
export function importFromWorkspace(wsRoot: string): ImportReport {
  const report: ImportReport = { copied: [], skipped: [], absent: [] };
  ensureLayout();
  const touched = new Set<Family>();

  for (const f of FOLDERS) {
    const src = join(wsRoot, f.from);
    if (!exists(src)) {
      report.absent.push(f.from);
      continue;
    }
    const before = report.copied.length;
    copyTree(src, f.to(), report);
    if (report.copied.length > before && f.family) touched.add(f.family);
  }

  // Only when something actually landed: an import that copied nothing changed nothing,
  // and moving the token would make every surface refetch a listing that is identical.
  for (const family of touched) bumped(family);
  return report;
}

/** Where an import's own bookkeeping would go, if it ever needs any. Kept out of the
 *  families so a copy never shows up as content. */
export const importCacheDir = (): string => join(cacheDir(), "import");
