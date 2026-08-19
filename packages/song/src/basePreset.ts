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

/**
 * The file a `base:` names, or undefined when it names nothing this folder has.
 *
 * Undefined rather than a path that does not exist, because the caller's next move differs: a
 * missing base must fall back to the module's plain `<name>.vstpreset` default, not load nothing
 * and leave the plugin at whatever a fresh instance happens to be.
 */
export function basePresetIn(
  folder: string,
  base: unknown,
): string | undefined {
  if (typeof base !== "string" || !base.trim()) return undefined;
  const file = join(folder, MODULE_BASES_DIR, `${base.trim()}${BASE_EXT}`);
  return existsSync(file) ? file : undefined;
}

/**
 * The `.vstpreset` a module actually loads, in precedence order.
 *
 * 1. the `base:` it CHOSE, if that base exists — an explicit answer beats every default;
 * 2. this node's own `<node>.vstpreset` — a per-placement state, so a UI edit on one node never
 *    touches a sibling's;
 * 3. the module's `<leaf>.vstpreset` — the folder's default.
 *
 * A chosen base sits above both because it is the only one somebody asked for by name. The other
 * two are where a state ends up when nobody said.
 */
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

/**
 * Every base this module may be set to: its own `base/`, plus that of every module it extends.
 *
 * Inherited for the same reason assets are, and it is the normal shape rather than a nicety: the
 * bases are snapshotted onto the SHARED module — the one that names the plugin and travels with
 * its sounds — and a song points at it through a thin local module that `extends` it. Listing
 * only the local folder would offer nothing on the one module built to be chosen from.
 *
 * A nearer base shadows an inherited one of the same name, matching `presetFor`, which looks in
 * the module's own folder and stops.
 */
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
