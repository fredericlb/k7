// libraryForks.ts — the FORKS of a library: the `_modules` and `@account` modules that `extends` one of
// its modules, and which of them would inherit something new on an upgrade, since the module they
// extend differs between the two versions. A fork keeps its own changes whatever happens; this only
// says which ones to listen to again. See ../../../docs/library-versions-plan.md.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { docPattern } from "@studio/song-schema/docExt";
import type { LibraryVersion } from "@studio/song-schema/libraryVersions";
import {
  ACCOUNT_LIBRARY,
  libraryRefParts,
  SHARED_MODULES_DIR,
} from "@studio/song-schema/moduleTypes";
import { accountLibraryHome, libraryVersionRoot } from "./sharedFolders";
import { wsData } from "./yaml/workspaceDoc";

const MODULE_FILE = docPattern("^module", "");

/** One fork: the workspace module, and the library module it extends. */
export interface LibraryFork {
  /** Where it is: `_modules/<path>` or `@account/<path>`. */
  module: string;
  /** What it extends, `@<library>/<path>`. */
  base: string;
}

/** Every `module.k7x` under `dir`, recursively, skipping dot-folders. */
function moduleFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const abs = join(dir, name);
    if (MODULE_FILE.test(name)) out.push(abs);
    else if (statSync(abs).isDirectory()) out.push(...moduleFiles(abs));
  }
  return out;
}

/** The workspace's modules at `repoDir`, and the account's, that extend a module of `library`. */
export function libraryForks(repoDir: string, library: string): LibraryFork[] {
  const forks: LibraryFork[] = [];
  const roots = [
    { root: join(repoDir, SHARED_MODULES_DIR), label: SHARED_MODULES_DIR },
    {
      root: join(accountLibraryHome(), "modules"),
      label: `@${ACCOUNT_LIBRARY}`,
    },
  ];
  for (const { root, label } of roots)
    for (const file of moduleFiles(root)) {
      let doc: unknown;
      try {
        doc = wsData(file);
      } catch {
        continue;
      }
      const ext = (doc as { extends?: unknown } | null)?.extends;
      if (typeof ext !== "string") continue;
      const parts = libraryRefParts(ext);
      if (parts?.library !== library) continue;
      const at = relative(root, join(file, "..")).split(/[\\/]/).join("/");
      forks.push({ module: `${label}/${at}`, base: ext });
    }
  return forks.sort((a, b) => a.module.localeCompare(b.module));
}

/** A digest of a library module's folder at one version, or null when that version has no such module. */
export function libraryModuleDigest(
  library: string,
  version: LibraryVersion,
  ref: string,
): string | null {
  const parts = libraryRefParts(ref);
  if (!parts) return null;
  // A ref may name one node of the module (`…/x:warm`); the folder is the module's.
  const path = parts.rest.split(":")[0];
  const dir = join(libraryVersionRoot(library, version), "modules", path);
  if (!existsSync(dir)) return null;
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      if (name.startsWith(".")) continue;
      const abs = join(at, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else
        hash.update(relative(dir, abs)).update("\0").update(readFileSync(abs));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

/** The forks whose base differs between `from` and `to` — gone from `to` counts as differing. */
export function forksWhoseBaseMoved(
  repoDir: string,
  library: string,
  from: LibraryVersion,
  to: LibraryVersion,
): LibraryFork[] {
  return libraryForks(repoDir, library).filter(
    (f) =>
      libraryModuleDigest(library, from, f.base) !==
      libraryModuleDigest(library, to, f.base),
  );
}
