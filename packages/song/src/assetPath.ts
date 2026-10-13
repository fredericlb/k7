// assetPath.ts — where a file-valued param's ref lands on disk, and the containment rule that
// keeps it inside the module. A leaf: `node:fs` and modelCache only, so both the loader and the
// ancestry fold can use the ONE copy of that check. See docs/moduleAssets.md.

import { isAbsolute, resolve, sep } from "node:path";
import { MODULE_SOURCES_DIR } from "@studio/song-schema/moduleTypes";
import { modelsRoot } from "./modelCache";
import { wsExists } from "./yaml/workspaceFile";

/** Where a module keeps the files it loads, inside its own folder. */
export const MODULE_ASSETS_DIR = "assets";

/** A rack's audio folder, defined in song-schema so a browser knows the word too. */
export { MODULE_SOURCES_DIR };

/** `<folder>/<sub>/<ref>` for the first folder holding it, CONFINED to each — docs/moduleAssets.md. */
export function resolveModuleFileIn(
  ref: unknown,
  folders: readonly (string | undefined)[],
  sub: string,
): string | undefined {
  if (typeof ref !== "string" || !ref || isAbsolute(ref)) return undefined;
  for (const folder of folders) {
    if (!folder) continue;
    const root = resolve(folder, sub);
    const abs = resolve(root, ref);
    // Escaping is a property of the REF, so one refusal ends it — trying the next folder lets `../` through.
    if (!(abs === root || abs.startsWith(root + sep))) return undefined;
    if (wsExists(abs)) return abs;
  }
  return undefined;
}

/** The same, for `assets/`, falling back to the shared model cache — docs/moduleAssets.md. */
export function resolveModuleAssetIn(
  ref: unknown,
  folders: readonly (string | undefined)[],
): string | undefined {
  const own = resolveModuleFileIn(ref, folders, MODULE_ASSETS_DIR);
  if (own) return own;
  if (typeof ref !== "string" || !ref || isAbsolute(ref)) return undefined;
  const cacheRoot = modelsRoot();
  const cached = resolve(cacheRoot, ref);
  const inCache = cached === cacheRoot || cached.startsWith(cacheRoot + sep);
  return inCache && wsExists(cached) ? cached : undefined;
}
