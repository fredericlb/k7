// types.ts — what the mediatek catalogue hands out. Types only, shared by the scan, the
// HTTP routes and every surface that lists the library.

/** The four things the mediatek holds. Each is scanned, indexed and invalidated ALONE. */
export type Family = "morceaux" | "samples" | "modules" | "chains";

export const FAMILIES: readonly Family[] = [
  "morceaux",
  "samples",
  "modules",
  "chains",
];

/**
 * The raw capture zone: its folder at the root, its key in the revision map, its key in the
 * summary counts, and the id of its tab. One word for all four, deliberately.
 *
 * Here beside FAMILIES rather than in layout.ts — where the rest of the shape lives, and
 * which re-exports this — because the BROWSER needs the word too, and layout.ts opens
 * `node:fs`. See docs/recordings.md.
 */
export const RECORDINGS_DIR = "recordings";

/** One catalogued thing. Deliberately flat and family-agnostic: a listing is a listing,
 *  and the family-specific detail a surface needs is in `kind` and `meta`. */
export interface MediatekEntry {
  family: Family;
  /** Stable id: the entry's mediatek-relative POSIX path. Nothing else is stable across
   *  a rescan — a rowid would need a database, which this deliberately has not got. */
  id: string;
  /** What to show. The title from a sidecar when there is one, else the file/folder name. */
  name: string;
  /** Mediatek-relative POSIX path — to the folder for a morceau or a module, to the file for a sample. */
  path: string;
  /** The family's own subdivision: "imported" | "recorded" for morceaux, "audio" | "video"
   *  for samples, the module type folder ("instruments", "audio", …) for modules. */
  kind: string;
  /** Bytes of the entry's payload — the master for a morceau, the file for a sample. Absent for a module. */
  bytes?: number;
  /** Newest mtime under the entry, ms since epoch. What a surface sorts "recent" by. */
  mtime: number;
  /** The entry's OWN files, by name, when the entry is a folder rather than a file — a module.
   *  A tree drawing one shows exactly these: its instances, its panel, its shelf, a .vstpreset,
   *  a jsdsp source. Nothing more, because a row for a file that is not there lies about the
   *  disk — and nothing less, because the tree used to draw three fixed rows and whatever had
   *  actually been dropped in vanished. */
  files?: string[];
  /** Family-specific extras, all optional: artist/title for a morceau, the pack for a
   *  sample, whether a module folder actually carries a module.yaml. */
  meta?: Record<string, string | number | boolean>;
}

/** A whole family's listing plus the token it was read at. */
export interface FamilyListing {
  family: Family;
  rev: string;
  entries: MediatekEntry[];
  /** Family-relative paths NO entry accounts for — an empty folder, a loose file. A tree
   *  draws itself from the entry paths, so without these anything that is not an entry is
   *  invisible: the folder `POST /folder` just made, a file dropped where no catalogue
   *  reaches. An entry's own insides are not here; they are its `files`. See scanUnlisted. */
  unlisted: string[];
}
