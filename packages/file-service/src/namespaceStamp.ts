// namespaceStamp.ts — the boot's namespace migration, skipped for a workspace whose sources have not
// moved since it last ran: a stamp of every source file's path, size and mtime, kept beside the
// workspace in its sync state, never in it. A rule added to the migration bumps NAMESPACE_RULES, or
// a workspace stamped before it would never be rewritten by it. See docs/workspaces.md.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "@studio/song/atomicWrite";
import { migrateNamespaceIn } from "@studio/song/namespaceMigrate";
import { isDocFile } from "@studio/song-schema/docExt";
import {
  LEGACY_LIBRARY_MANIFEST,
  LEGACY_LIBRARY_PINS_FILE,
} from "@studio/song-schema/libraryVersionsLegacy";
import { liveLogFor } from "./liveLog.ts";

/** The version of `@studio/song/namespaceMigrate`'s rules: bumped whenever it learns a new rewrite. */
const NAMESPACE_RULES = 1;
const STAMP_FILE = "namespace-migrated";

const isSource = (name: string): boolean =>
  isDocFile(name) ||
  name === LEGACY_LIBRARY_PINS_FILE ||
  name === LEGACY_LIBRARY_MANIFEST;

/** The files the migration reads under `dir`, as the stamp sees them — its walk's own skips. */
function sourcesStamp(dir: string): string {
  const lines: string[] = [];
  const walk = (at: string): void => {
    let names: string[];
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const name of names) {
      if (
        name.startsWith(".") ||
        name === "node_modules" ||
        name === "_history"
      )
        continue;
      const p = join(at, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (isSource(name)) lines.push(`${p}:${st.size}:${st.mtimeMs}`);
      } catch {
        /* vanished meanwhile: the migration would skip it too */
      }
    }
  };
  walk(dir);
  const hash = createHash("sha1").update(lines.sort().join("\n"));
  return `${NAMESPACE_RULES}:${hash.digest("hex")}`;
}

/** `migrateNamespaceIn(root, true)`, unless nothing it reads moved since the last run; answers the files rewritten. */
export function migrateNamespaceOnce(root: string): { file: string }[] {
  const at = join(liveLogFor(root), STAMP_FILE);
  let was = "";
  try {
    was = readFileSync(at, "utf8");
  } catch {
    /* never stamped */
  }
  if (was && was === sourcesStamp(root)) return [];
  const changed = migrateNamespaceIn(root, true);
  try {
    mkdirSync(liveLogFor(root), { recursive: true });
    writeFileAtomic(at, sourcesStamp(root));
  } catch {
    /* unstamped, the next start reads every file again */
  }
  return changed;
}
