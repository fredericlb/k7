// legacyUpgrade.ts — a library pins file or manifest still in YAML, rewritten ONCE as its .k7x twin.
// A reader would get wrong that the .yaml goes first: it is removed only once the .k7x reads back as the same data.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { writeFileAtomic } from "@studio/song/atomicWrite";

/** How one kind of file is read in either format and written as k7x. */
export interface LegacyKind<T> {
  parseLegacy: (yaml: string) => T | null;
  parse: (k7x: string) => T | null;
  stringify: (value: T) => string;
}

/** Writes `file` from `legacy` when only the legacy one exists; answers the data, or null when there was nothing to upgrade or it did not read. */
export function upgradeLegacy<T>(
  legacy: string,
  file: string,
  kind: LegacyKind<T>,
): T | null {
  if (existsSync(file) || !existsSync(legacy)) return null;
  let value: T | null;
  try {
    value = kind.parseLegacy(readFileSync(legacy, "utf8"));
  } catch {
    return null;
  }
  if (value === null) return null;
  try {
    writeFileAtomic(file, kind.stringify(value));
    const back = kind.parse(readFileSync(file, "utf8"));
    // A copy that does not say the same thing is taken back, and the legacy file stays the truth.
    if (!isDeepStrictEqual(back, value)) {
      rmSync(file, { force: true });
      return value;
    }
    rmSync(legacy, { force: true });
  } catch {
    /* read-only: the legacy file is still read, and the next pass upgrades it */
  }
  return value;
}
