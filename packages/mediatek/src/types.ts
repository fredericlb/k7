// types.ts — what the mediatek catalogue hands out. Types only, shared by the scan, the
// HTTP routes and every surface that lists the library.

/** The three things the mediatek holds. Each is scanned, indexed and invalidated ALONE. */
export type Family = "morceaux" | "samples" | "modules";

export const FAMILIES: readonly Family[] = ["morceaux", "samples", "modules"];

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
  /** Family-specific extras, all optional: artist/title for a morceau, the pack for a
   *  sample, whether a module folder actually carries a module.yaml. */
  meta?: Record<string, string | number | boolean>;
}

/** A whole family's listing plus the token it was read at. */
export interface FamilyListing {
  family: Family;
  rev: string;
  entries: MediatekEntry[];
}
