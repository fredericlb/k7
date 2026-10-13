// libraryVersions.ts — a library as a series of FROZEN versions: the level st0 runs, what a version's
// `library.yaml` says, and the pins a workspace keeps in `_library-pins.yaml`. No `node:fs`, so
// the file service and the browser read them by the same rules. Rationale: docs/library-versions-plan.md.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** What this st0 can run: a library whose `requires` is above it is refused — raise it when a library may use something new. */
export const LIBRARY_LEVEL = 1;

/** The folder an admin edits a library in, beside its published versions. */
export const DRAFT_VERSION = "draft";

/** A version a workspace may pin: a published number, or the draft an admin is testing. */
export type LibraryVersion = number | typeof DRAFT_VERSION;

/** The manifest every published version carries at its root. */
export const LIBRARY_MANIFEST = "library.yaml";

/** The file a workspace keeps its pins in, at its root beside `_modules/`. */
export const LIBRARY_PINS_FILE = "_library-pins.yaml";

/** The version a library the pins do not name resolves to: every library published before versions is its version 1. */
export const UNPINNED_VERSION = 1;

/** A published version's folder name: a positive integer, written without leading zeros. */
export const VERSION_DIR = /^[1-9][0-9]{0,5}$/;

/** A folder name as the version it holds, or null when it is no version folder. */
export function versionOfDir(name: string): LibraryVersion | null {
  if (name === DRAFT_VERSION) return DRAFT_VERSION;
  return VERSION_DIR.test(name) ? Number(name) : null;
}

/** What a published version says about itself. */
export interface LibraryManifest {
  name: string;
  version: number;
  /** The lowest LIBRARY_LEVEL that runs it. */
  requires: number;
  notes?: string;
}

const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;

/** Read a `library.yaml`, or null when the text is not one. */
export function parseLibraryManifest(text: string): LibraryManifest | null {
  let doc: unknown;
  try {
    doc = parseYaml(text, { version: "1.2" });
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  const version = int(d.version);
  const requires = int(d.requires) ?? 1;
  if (typeof d.name !== "string" || !version) return null;
  const out: LibraryManifest = { name: d.name, version, requires };
  if (typeof d.notes === "string" && d.notes.trim()) out.notes = d.notes.trim();
  return out;
}

/** Write a `library.yaml`. */
export function stringifyLibraryManifest(m: LibraryManifest): string {
  return stringifyYaml(m);
}

/** Can a st0 at `level` run this version? */
export const isRunnable = (
  m: LibraryManifest,
  level = LIBRARY_LEVEL,
): boolean => m.requires <= level;

/** A workspace's pins, library name → version; a library absent here is UNPINNED_VERSION. */
export type LibraryPins = Record<string, LibraryVersion>;

/** Read `_library-pins.yaml`; an entry that is no version is dropped, so it reads as unpinned. */
export function parseLibraryPins(text: string): LibraryPins {
  let doc: unknown;
  try {
    doc = parseYaml(text, { version: "1.2" });
  } catch {
    return {};
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
  const out: LibraryPins = {};
  for (const [name, v] of Object.entries(doc as Record<string, unknown>)) {
    if (v === DRAFT_VERSION) out[name] = DRAFT_VERSION;
    else if (int(v)) out[name] = v as number;
  }
  return out;
}

/** Write `_library-pins.yaml`, libraries in name order so a diff stays one line. */
export function stringifyLibraryPins(pins: LibraryPins): string {
  const sorted: LibraryPins = {};
  for (const name of Object.keys(pins).sort()) sorted[name] = pins[name];
  return stringifyYaml(sorted);
}

/** The version `pins` resolves `library` to. */
export const pinnedVersion = (
  pins: LibraryPins,
  library: string,
): LibraryVersion => pins[library] ?? UNPINNED_VERSION;
