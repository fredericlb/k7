// assetPath.ts — where a file-valued param's ref lands on disk, and the containment rule that
// keeps it inside the module. A leaf: `node:fs` and modelCache only, so both the loader and the
// ancestry fold can use the ONE copy of that check. See docs/moduleAssets.md.

import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { modelsRoot } from "./modelCache";

/** Where a module keeps the files it loads, inside its own folder. */
export const MODULE_ASSETS_DIR = "assets";

/** `<folder>/assets/<ref>` for the first folder holding it, CONFINED to each — docs/moduleAssets.md. */
export function resolveModuleAssetIn(
  ref: unknown,
  folders: readonly (string | undefined)[],
): string | undefined {
  if (typeof ref !== "string" || !ref || isAbsolute(ref)) return undefined;
  for (const folder of folders) {
    if (!folder) continue;
    const root = resolve(folder, MODULE_ASSETS_DIR);
    const abs = resolve(root, ref);
    // Escaping is a property of the REF, so one refusal ends it — trying the next folder lets `../` through.
    if (!(abs === root || abs.startsWith(root + sep))) return undefined;
    if (existsSync(abs)) return abs;
  }
  const cacheRoot = modelsRoot();
  const cached = resolve(cacheRoot, ref);
  const inCache = cached === cacheRoot || cached.startsWith(cacheRoot + sep);
  return inCache && existsSync(cached) ? cached : undefined;
}
