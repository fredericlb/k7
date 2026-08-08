// assetPath.ts — where a file-valued param's ref lands on disk, and the containment rule that
// keeps it inside the module. A leaf: `node:fs` and modelCache only, so both the loader and the
// ancestry fold can use the ONE copy of that check. See docs/moduleAssets.md.

import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { modelsRoot } from "./modelCache";

/** Where a module keeps the files it loads, inside its own folder. */
export const MODULE_ASSETS_DIR = "assets";

/**
 * `<folder>/assets/<ref>` for the first folder that holds it, or undefined.
 *
 * CONFINED to each folder — a `../..` ref is refused rather than resolved, so a module cannot
 * reach outside itself for its sound. The check runs per folder, and a ref that escapes one is
 * refused there rather than being tried against the next: escaping is a property of the ref.
 *
 * Several folders because a module inherits: the amp that carries the profiles is the one it
 * `extends`, and the local module overriding which profile to load carries none of its own.
 * Nearest first, so a local file shadows an inherited one of the same name — the precedence
 * `moduleAssetChoices` offers them in.
 *
 * Falling back to the machine's model cache is the ONE exception, and it is not a hole in that
 * rule: the ref is still a plain name, still refused if it climbs out, and the cache is only
 * consulted for a name that survived the check. What it buys is a model too big to travel —
 * `moduleAssets.md` argues a module carries its material so it survives a fork, and that argument
 * inverts past a few hundred megabytes.
 */
export function resolveModuleAssetIn(
  ref: unknown,
  folders: readonly (string | undefined)[],
): string | undefined {
  if (typeof ref !== "string" || !ref || isAbsolute(ref)) return undefined;
  for (const folder of folders) {
    if (!folder) continue;
    const root = resolve(folder, MODULE_ASSETS_DIR);
    const abs = resolve(root, ref);
    // Escaping is a property of the REF, not of the folder it was tried against, so one
    // refusal ends it — never "try the next folder", which would make `../` a way through.
    if (!(abs === root || abs.startsWith(root + sep))) return undefined;
    if (existsSync(abs)) return abs;
  }
  const cacheRoot = modelsRoot();
  const cached = resolve(cacheRoot, ref);
  const inCache = cached === cacheRoot || cached.startsWith(cacheRoot + sep);
  return inCache && existsSync(cached) ? cached : undefined;
}
