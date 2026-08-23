// A module's named BASES — the `.vstpreset` blobs in its own `base/` folder, and which one a
// module or node has chosen. Rationale, and why a base is not a preset: docs/userPresets.md.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The folder a module keeps its bases in, and the extension they carry. */
export const MODULE_BASES_DIR = "base";
const BASE_EXT = ".vstpreset";

/** The bases in ONE folder, by name and without the extension, in a stable order. */
export function basesIn(folder: string | null | undefined): string[] {
  if (!folder) return [];
  try {
    return readdirSync(join(folder, MODULE_BASES_DIR))
      .filter((f) => f.toLowerCase().endsWith(BASE_EXT))
      .map((f) => f.slice(0, -BASE_EXT.length))
      .sort();
  } catch {
    return []; // no base/ folder, or one that cannot be read — both are "this module has none"
  }
}

/** The file a `base:` names, or undefined so the caller falls back to the module's default. */
export function basePresetIn(
  folder: string,
  base: unknown,
): string | undefined {
  if (typeof base !== "string" || !base.trim()) return undefined;
  const file = join(folder, MODULE_BASES_DIR, `${base.trim()}${BASE_EXT}`);
  return existsSync(file) ? file : undefined;
}

/** The `.vstpreset` a module loads: the chosen `base:`, then the node's, then the module's own. */
export function presetFor(
  folder: string,
  leaf: string,
  node: string | undefined,
  base: unknown,
): string | undefined {
  return (
    basePresetIn(folder, base) ??
    [
      join(folder, `${node ?? leaf}${BASE_EXT}`),
      join(folder, `${leaf}${BASE_EXT}`),
    ].find(existsSync)
  );
}

// A cycle in `extends` is already refused upstream; this is a backstop so a bad file cannot hang a UI request.
const MAX_ANCESTRY = 16;

/** Just enough of a module to find its folder and its parent — the resolved map and the ref map both fit. */
interface BaseOwner {
  extends?: unknown;
  /** Where its files are, stamped by the loader on every module it reads. */
  folderAbs?: unknown;
}

/** Every base this module may be set to, its ancestors' included — see docs/userPresets.md. */
export function moduleBaseChoices(
  module: BaseOwner | undefined,
  refs: Readonly<Record<string, BaseOwner>>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (folder: unknown) => {
    if (typeof folder !== "string" || !folder) return;
    for (const b of basesIn(folder))
      if (!seen.has(b)) {
        seen.add(b);
        out.push(b);
      }
  };
  add(module?.folderAbs);
  let ref = module?.extends;
  for (let i = 0; i < MAX_ANCESTRY && typeof ref === "string" && ref; i++) {
    const parent = refs[ref];
    add(parent?.folderAbs);
    ref = parent?.extends;
  }
  return out;
}
