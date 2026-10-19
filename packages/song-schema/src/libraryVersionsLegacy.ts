// libraryVersionsLegacy.ts — a `library.yaml` or `_library-pins.yaml` still on disk, read so its owner upgrades it once.
// The owner reads with these, writes the k7x file through libraryVersions.ts, then removes the `.yaml`; nothing writes YAML.

import { parse as parseYaml } from "yaml";
import {
  type LibraryManifest,
  type LibraryPins,
  libraryManifestData,
  libraryPinsData,
} from "./libraryVersions";

/** The manifest's name before it was k7x, looked for beside `library.k7x`. */
export const LEGACY_LIBRARY_MANIFEST = "library.yaml";

/** The pins' name before they were k7x, looked for beside `_library-pins.k7x`. */
export const LEGACY_LIBRARY_PINS_FILE = "_library-pins.yaml";

/** What yamlData answers for a text that does not read, apart from an empty one. */
const UNREADABLE = Symbol("unreadable");

/** The YAML text's data, or UNREADABLE when it does not read. */
function yamlData(text: string): unknown {
  try {
    return parseYaml(text, { version: "1.2" });
  } catch {
    return UNREADABLE;
  }
}

/** Read a legacy `library.yaml`, or null when the text is not one. */
export function parseLegacyLibraryManifest(
  text: string,
): LibraryManifest | null {
  const data = yamlData(text);
  return data === UNREADABLE ? null : libraryManifestData(data);
}

/** Read a legacy `_library-pins.yaml`: null when it is not a map, so its owner leaves it on disk to be fixed rather than upgrade it to no pins. */
export function parseLegacyLibraryPins(text: string): LibraryPins | null {
  const data = yamlData(text);
  if (data === null || data === undefined) return {};
  if (data === UNREADABLE || typeof data !== "object" || Array.isArray(data))
    return null;
  return libraryPinsData(data);
}
