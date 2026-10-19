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

/** The YAML text's data, or null when it does not read. */
function yamlData(text: string): unknown {
  try {
    return parseYaml(text, { version: "1.2" });
  } catch {
    return null;
  }
}

/** Read a legacy `library.yaml`, or null when the text is not one. */
export function parseLegacyLibraryManifest(
  text: string,
): LibraryManifest | null {
  return libraryManifestData(yamlData(text));
}

/** Read a legacy `_library-pins.yaml`; a text that does not read is no pins. */
export function parseLegacyLibraryPins(text: string): LibraryPins {
  return libraryPinsData(yamlData(text));
}
