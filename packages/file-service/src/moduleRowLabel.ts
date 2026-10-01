// moduleRowLabel.ts — the `label:` a module folder's module.yaml carries, for the file tree's row
// (packages/song/docs/moduleLabel.md). The tree is rebuilt on every revision and most modules never
// change, so a label is cached by the file's mtime. The one thing a reader would get wrong: a file
// that does not load has NO label here, never an error — the tree must draw whatever is on disk.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { moduleLabelOf } from "@studio/song-schema/moduleTypes";
import { parseModule } from "@studio/song-schema/yaml/moduleFile";

const MODULE_FILE = /^module\.ya?ml$/i;
const cache = new Map<string, { mtimeMs: number; label: string }>();

/** The label of the module in `dirAbs`, given the names in it; undefined for a folder that is no module or has none. */
export function moduleRowLabel(
  dirAbs: string,
  names: readonly string[],
): string | undefined {
  const file = names.find((n) => MODULE_FILE.test(n));
  if (!file) return undefined;
  const abs = join(dirAbs, file);
  try {
    const { mtimeMs } = statSync(abs);
    const hit = cache.get(abs);
    if (hit && hit.mtimeMs === mtimeMs) return hit.label || undefined;
    // Refused mid-edit: no label until the file is valid again.
    const label = moduleLabelOf(parseModule(readFileSync(abs, "utf8")).value);
    cache.set(abs, { mtimeMs, label });
    return label || undefined;
  } catch {
    return undefined;
  }
}
