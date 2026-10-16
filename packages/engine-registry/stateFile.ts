// stateFile.ts — the registry's JSON files under its host's state dir (the bindings, the owners):
// written whole through a temp file renamed over the old one, 0600 in a 0700 folder, and an
// unreadable file SET ASIDE rather than overwritten, so a bad write never costs what it replaced.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/** Write `data` to `file` atomically; a failure is said, never thrown, since the in-memory copy still holds. */
export function saveJson(
  file: string,
  data: unknown,
  what: string,
  log: (line: string) => void,
): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    log(`could not save the ${what}: ${(e as Error).message}`);
  }
}

/** The parsed file, undefined when absent; an unreadable one is renamed aside and said. */
export function loadJson(
  file: string,
  what: string,
  log: (line: string) => void,
): unknown {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    const aside = `${file}.unreadable-${Date.now()}`;
    try {
      renameSync(file, aside);
    } catch {
      /* left where it is; the next save replaces it */
    }
    log(`${what} unreadable (${(e as Error).message}), set aside as ${aside}`);
    return undefined;
  }
}
