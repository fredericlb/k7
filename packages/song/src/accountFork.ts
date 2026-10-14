// accountFork.ts — FORK a module of the origin's libraries into the account's own: a module at
// `@account/<path>` that `extends` it, its panel copied so it draws the same, and the project's refs
// repointed to it. The library is never written: changing a module of it is forking it, and the
// fork keeps inheriting whatever it does not change. See ../../../docs/library-versions-plan.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_LIBRARY,
  libraryRef,
  libraryRefParts,
} from "@studio/song-schema/moduleTypes";
import { repointRefs } from "./moduleMove";
import { accountLibraryHome, libraryFamilyRoot } from "./sharedFolders";
import { wsCopy, wsExists, wsWrite } from "./yaml/workspaceFile";

/** What a fork did: the new ref, its folder, and the project files that now name it. */
export interface AccountFork {
  ref: string;
  folder: string;
  created: boolean;
  repointed: string[];
}

/** Fork the library module `ref` (as `projectDir`'s workspace pins it) into `@account`, and repoint the project to it. */
export function forkIntoAccount(projectDir: string, ref: string): AccountFork {
  const parts = libraryRefParts(ref);
  if (!parts || parts.library === ACCOUNT_LIBRARY)
    throw new Error(`${ref} is no module of the origin's libraries`);
  // A ref may name one node of the module (`…/x:warm`); the fork is of the module.
  const path = parts.rest.split(":")[0];
  const segs = path.split("/");
  if (segs.some((s) => !s || s === "." || s === ".."))
    throw new Error(`${ref} is no module path`);
  const modules = libraryFamilyRoot(parts.library, "modules", projectDir);
  const base = modules ? join(modules, ...segs) : null;
  if (!base || !wsExists(join(base, "module.yaml")))
    throw new Error(
      `${ref}: no such module in the version this workspace plays`,
    );
  const baseRef = libraryRef(parts.library, path);
  const forkRef = libraryRef(ACCOUNT_LIBRARY, path);
  const folder = join(accountLibraryHome(), "modules", ...segs);
  // Already forked: the project is pointed at it, and what the fork holds is left alone.
  const created = !wsExists(join(folder, "module.yaml"));
  if (created) {
    mkdirSync(folder, { recursive: true });
    wsWrite(join(folder, "module.yaml"), `extends: "${baseRef}"\n`);
    if (wsExists(join(base, "ui.yaml")))
      wsCopy(join(base, "ui.yaml"), join(folder, "ui.yaml"));
  }
  const repointed = repointRefs([projectDir], baseRef, forkRef);
  return { ref: forkRef, folder, created, repointed };
}
