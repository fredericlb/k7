// librariesAnchor.ts — a directory to resolve `@st0/…` against for a caller that names no
// workspace. One account has ONE libraries repository, cloned into each of its workspaces, so
// any clone answers the same question. See docs/processChain.md.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LIBRARIES_DIR } from "@studio/song/sharedFolders";
import { slugify, userRoot } from "./slug.ts";

/** A path to hand `resolveChain` when a request has no workspace; ANY of the account's will do (docs/processChain.md). */
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
    // The leaf is a PLACEHOLDER `librariesDirFor` only resolves `..` off, and is named for that.
    return join(ws, "(no project)");
  }
  return null;
}
