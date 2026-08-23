// librariesAnchor.ts — a directory to resolve `@st0/…` against for a caller that names no
// workspace. One account has ONE libraries repository, cloned into each of its workspaces, so
// any clone answers the same question. See docs/processChain.md.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LIBRARIES_DIR } from "@studio/song/sharedFolders";
import { slugify, userRoot } from "./slug.ts";

/**
 * A path to hand `resolveChain`, for a request with no workspace on it.
 *
 * `resolveChain` takes a PROJECT dir and reaches the libraries at `../_libraries`
 * (`librariesDirFor`), so what it actually needs is somewhere one level under a workspace root.
 * This returns such a path — a workspace root joined with a name that need not exist, because
 * nothing reads the leaf; only its parent is walked.
 *
 * ANY workspace of this account will do, and that is the whole reason this can exist. The
 * libraries are a git submodule of the account's one library repository, mounted identically in
 * every workspace: two clones that disagreed would be two checkouts of the same remote at
 * different commits, which is a sync problem rather than an ambiguity about what `@st0/stems`
 * means. The first one holding a checkout wins, in readdir order, so the answer is stable for as
 * long as the disk is.
 *
 * Null when the account has no workspace with a libraries checkout — a real and fixable state
 * (nothing has been cloned on this machine yet), which the caller reports rather than throwing.
 */
export function librariesAnchor(userEmail: string): string | null {
  const root = userRoot(slugify(userEmail));
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return null; // no root at all — this machine has never opened a project for this account
  }
  for (const name of names.sort()) {
    const ws = join(root, name);
    if (!existsSync(join(ws, LIBRARIES_DIR))) continue;
    // The leaf is a PLACEHOLDER and is never opened: `librariesDirFor` only resolves `..` off
    // it. Named for what it is, so an error message quoting the path does not send anybody
    // looking for a project that was never there.
    return join(ws, "(no project)");
  }
  return null;
}
