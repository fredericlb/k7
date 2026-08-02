// write.ts — putting a file into the library and taking one out, on whichever side owns
// it. Bumps the family's mutation counter, because a write the walk cannot see (same file
// count, same tick) is exactly the case the counter exists for. See docs/index.md.

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { ensureLayout, mediatekDir, writablePath } from "./layout.ts";
import { bumped } from "./revision.ts";
import { FAMILIES, type Family } from "./types.ts";

/** Which family a path belongs to, or null for the shared `library`/`ui` folders and
 *  anything else — those have no token of their own. */
export function familyOf(rel: string): Family | null {
  const top = rel.split(/[\\/]+/)[0];
  return FAMILIES.includes(top as Family) ? (top as Family) : null;
}

/**
 * Write one file, creating its folder.
 *
 * Written beside and renamed, like the cache's downloads and for the same reason: the
 * moteur may be reading this tree, and a half-written module.yaml is a project that will
 * not compile.
 */
export function putFile(rel: string, body: Uint8Array | string): string {
  ensureLayout();
  const abs = writablePath(rel);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.part`;
  writeFileSync(tmp, body);
  renameSync(tmp, abs);
  // `ui` panels belong to the modules that wear them — the same grouping the scan uses.
  const fam = familyOf(relative(mediatekDir(), abs).split(sep).join("/"));
  if (fam) bumped(fam);
  else if (rel.startsWith("ui/")) bumped("modules");
  return abs;
}

/** Remove one file. Absent is success: the caller wanted it gone. */
export function removeFile(rel: string): void {
  const abs = writablePath(rel);
  rmSync(abs, { force: true });
  const fam = familyOf(relative(mediatekDir(), abs).split(sep).join("/"));
  if (fam) bumped(fam);
  else if (rel.startsWith("ui/")) bumped("modules");
}
