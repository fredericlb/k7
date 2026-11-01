// moduleCase.ts — a module named the way a person typed it, read back as the project spells it.
// Case never decides which module a line means (`io/MiDi` is `io/MIDI`); a name that matches
// nothing keeps the typed case, since that is the spelling a new module is created under.

import { readdirSync } from "node:fs";
import { IO_MODULES, MODULE_TYPES } from "@studio/song-schema/moduleTypes";

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The one entry of `names` spelled like `typed` but for case, else `typed` itself. */
function spelled(typed: string, names: Iterable<string>): string {
  for (const n of names) if (sameName(n, typed)) return n;
  return typed;
}

/** `<category>/<name>` in the project's own spelling: the category, then the io role, a known ref or a folder on disk. */
export function canonicalTarget(
  target: string,
  known: readonly string[],
  categoryFolder: (category: string) => string,
): string {
  if (target.startsWith("@")) return spelled(target, known);
  const segs = target.split("/");
  // Not `<category>/<name>`: the verb refuses it as typed.
  if (segs.length !== 2 || !segs[0] || !segs[1]) return target;
  const [rawCategory, rawName] = segs;
  const category = spelled(rawCategory, Object.keys(MODULE_TYPES));
  if (category === "io")
    return `io/${spelled(rawName, Object.keys(IO_MODULES))}`;
  const ref = spelled(`${category}/${rawName}`, known);
  if (ref !== `${category}/${rawName}`) return ref;
  let onDisk: string[] = [];
  try {
    onDisk = readdirSync(categoryFolder(category));
  } catch {
    // no folder for that category yet: nothing to match, the typed name is the new one
  }
  return `${category}/${spelled(rawName, onDisk)}`;
}
