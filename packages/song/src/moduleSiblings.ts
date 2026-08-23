// moduleSiblings.ts — finding one of a module folder's OWN files (`ui.yaml`, `controller.yaml`)
// across every module library a project can see, with the ref each folder gives it. One walk,
// because a second copy of it drifts: these files are keyed by folder, and a walk that
// disagreed about which folders exist would hand a module someone else's panel.

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { MODULE_TYPES, moduleRefOf } from "@studio/song-schema/moduleTypes";
import { moduleNamespaceOf, modulePanelRoots } from "./sharedFolders";
import { moduleFileFor } from "./yaml/moduleIO";

/** One found sibling: the ref of the module whose folder holds it, and where it is. */
export interface SiblingFile {
  ref: string;
  path: string;
  /** Library-relative, for an issue message that says which file. */
  rel: string;
}

/** Every `<base>.yaml` under one library, at the TWO depths the loaders' own walk uses. */
export function siblingsIn(
  root: string,
  ns: string | null,
  base: string,
): SiblingFile[] {
  const out: SiblingFile[] = [];
  const at = (folder: string, rel: string, ref: string): void => {
    const file = moduleFileFor(folder, rel, base);
    if (file)
      out.push({ ref, path: file.path, rel: `${rel}/${basename(file.path)}` });
  };
  const dirs = (abs: string): string[] => {
    try {
      return readdirSync(abs).filter((n) =>
        statSync(join(abs, n)).isDirectory(),
      );
    } catch {
      return []; // unreadable folder — the rest of the library still loads
    }
  };
  for (const type of Object.keys(MODULE_TYPES)) {
    const typeDir = join(root, type);
    if (!existsSync(typeDir)) continue;
    for (const name of dirs(typeDir)) {
      const folder = join(typeDir, name);
      at(
        folder,
        `${type}/${name}`,
        ns ? `@${ns}/${type}/${name}` : moduleRefOf(type, name),
      );
      // A category folder, one level deep, and only in a shared library — the one shape that files one.
      if (!ns) continue;
      for (const leaf of dirs(folder))
        at(
          join(folder, leaf),
          `${type}/${name}/${leaf}`,
          `@${ns}/${type}/${name}/${leaf}`,
        );
    }
  }
  return out;
}

/** Walk every library NEAREST FIRST, calling `take` once per ref — precedence, never a merge. */
export function eachLibrarySibling(
  dir: string,
  base: string,
  take: (found: SiblingFile, library: string) => void,
): void {
  // The project's OWN `modules/` is the one root that is no library, so its null namespace is named here.
  const own = resolve(join(dir, "modules"));
  for (const root of modulePanelRoots(dir)) {
    const ns = resolve(root) === own ? null : moduleNamespaceOf(root);
    const label = basename(root);
    for (const found of siblingsIn(root, ns, base)) take(found, label);
  }
}
