// types.ts — what the mediatek catalogue hands out. Types only, shared by the scan, the
// HTTP routes and every surface that lists the library.

/**
 * The two things the mediatek holds. Each is scanned, indexed and invalidated ALONE.
 *
 * There were five. `modules` and `chains` left with the editing: a module is authored in l8,
 * against a project where the plugin it names is actually LOADED, and it is committed to the
 * account's library repository — which is a git repository somebody owns, not a folder on this
 * volume. Two places holding the same modules meant one of them was always the stale copy, and
 * the hosted one could not be the true one: nothing here can instantiate a plugin.
 *
 * `playlists` left fourth, and for a different reason worth keeping apart from that one. Nothing
 * was wrong with hosting it — it is just that a playlist holds no BYTES. It is pure reference:
 * names of songs that stay right here, in a file that names them. Hosting reference bought
 * nothing this volume is good at, and cost the account a document it could not commit beside the
 * work it was written for. `_playlists/` in the workspace repository is where a set list is now,
 * and l8 is what opens one (`@studio/song/docs/playlists.md`).
 *
 * What is left is exactly what the médiathèque is FOR: bytes nobody edits in a text editor.
 * See apps/pl8/docs/projects.md and packages/song/docs/sharedFolders.md.
 */
export type Family = "songs" | "samples";

export const FAMILIES: readonly Family[] = ["songs", "samples"];

/** Narrow an untrusted query value to a Family, or undefined. Here rather than in each HTTP
 *  shell: both had their own copy, and a fourth family would have had to find them both. */
export const asFamily = (v: unknown): Family | undefined =>
  FAMILIES.includes(v as Family) ? (v as Family) : undefined;

/** What to tell a caller that named something else. The sentence, not the `{error}` wrapper —
 *  that shape is HTTP's and belongs to the shells. */
export const FAMILY_ERROR = `family must be one of: ${FAMILIES.join(", ")}`;

/**
 * The raw capture zone: its folder at the root, its key in the revision map, its key in the
 * summary counts, and the id of its tab. One word for all four, deliberately.
 *
 * Here beside FAMILIES rather than in layout.ts — where the rest of the shape lives, and
 * which re-exports this — because the BROWSER needs the word too, and layout.ts opens
 * `node:fs`. See docs/recordings.md.
 */
export const RECORDINGS_DIR = "recordings";

/**
 * The file that makes a folder a CHAIN — the same name, and the same shape, a l8 project uses
 * at its root.
 *
 * Literally the same now. It said `chains.yaml` while a project's said `graph.yaml`, on the
 * argument that a shared chain is a different object from a project's whole topology. It is not:
 * a chain is a FOLDER holding this file and a `nodes/` beside it, which is exactly what a project
 * holds, and the two differ only in a chain having no `project.yaml` and naming its ends
 * `@in`/`@out`. One name, so nothing downstream has to carry a second spelling.
 *
 * Here rather than in scan.ts for the reason RECORDINGS_DIR is: a browser reaching for the word
 * would otherwise pull `node:fs` in with it. scan.ts re-exports it, so every existing importer is
 * unchanged.
 */
export const CHAINS_FILE = "graph.yaml";

/** Where a chain keeps the nodes its segments name, beside its graph file — `instances/` until
 *  it was migrated to this. Here for the same reason CHAINS_FILE is: the médiathèque's chain
 *  pane and l8's `clip process` both name this folder, and only one of the two may open `node:fs`. */
export const NODES_DIR = "nodes";

/** The sidecar that makes a folder a SONG and carries its title, its provenance and its
 *  variants. Here for the same reason CHAINS_FILE is: pl8 opens one in an editor, and a
 *  browser reaching for the name must not pull `node:fs` in with it. scan.ts re-exports it. */
export const SONG_FILE = "song.yaml";

// A PLAYLIST had no such marker: it IS its file, not a folder around one, so the rule was the
// extension. Both the rule and the parser are `@studio/song/playlist` now, beside the workspace
// folder they read — see that package's docs/playlists.md.

/**
 * One alternative version of a song, declared in its sidecar. See docs/variants.md.
 *
 * Two kinds, and the scan can only tell them apart halfway: a FILE is a sibling of the
 * master and is confirmed by looking in the folder, a CHAIN is a template in the `chains`
 * family and is NOT confirmed here. That asymmetry is deliberate — the catalogue invalidates
 * one family at a time (see catalogue.ts's revision note), so a song whose listing
 * depended on the chains listing would serve a stale answer every time a chain changed.
 * `chain` therefore means "not a file beside it, so it names a chain"; whoever holds both
 * listings says whether that chain exists.
 */
export interface SongVariant {
  /** What the sidecar calls it — the key, and what a surface shows. */
  name: string;
  /** What it names, verbatim: a file beside the master. */
  ref: string;
  /**
   * Whether that file is actually THERE.
   *
   * It used to be `"file" | "chain"`: a value naming a file in the folder was a file variant,
   * anything else named a chain the médiathèque held. The chains family is gone, so the second
   * case is no longer another kind of variant — it is a sidecar naming something that is not
   * there, which is a thing to report rather than to resolve. A chain-backed variant written
   * before this reads as `missing`, which is exactly what it now is.
   */
  kind: "file" | "missing";
}

/** One catalogued thing. Deliberately flat and family-agnostic: a listing is a listing,
 *  and the family-specific detail a surface needs is in `kind` and `meta`. */
export interface MediatekEntry {
  family: Family;
  /** Stable id: the entry's mediatek-relative POSIX path. Nothing else is stable across
   *  a rescan — a rowid would need a database, which this deliberately has not got. */
  id: string;
  /** What to show. The title from a sidecar when there is one, else the file/folder name. */
  name: string;
  /** Mediatek-relative POSIX path — to the folder for a song or a module, to the file for a sample. */
  path: string;
  /** The family's own subdivision: "audio" | "video" for samples, the module type folder
   *  ("instruments", "audio", …) for modules. **Empty for a song**, which has no subdivision:
   *  `songs/` is flat below the artist, and the provenance split it used to carry
   *  (`imported`/`recorded`) is the `recordings/` zone's job. A surface must therefore treat
   *  "" as "this family does not divide", not as a missing value. */
  kind: string;
  /** Bytes of the entry's payload — the master for a song, the file for a sample. Absent for a module. */
  bytes?: number;
  /** Newest mtime under the entry, ms since epoch. What a surface sorts "recent" by. */
  mtime: number;
  /** The entry's OWN files, by name, when the entry is a folder rather than a file — a module.
   *  A tree drawing one shows exactly these: its nodes, its panel, its shelf, a .vstpreset,
   *  a jsdsp source. Nothing more, because a row for a file that is not there lies about the
   *  disk — and nothing less, because the tree used to draw three fixed rows and whatever had
   *  actually been dropped in vanished. */
  files?: string[];
  /**
   * What the entry's own `assets/` folder holds — the samples, impulse responses and amp
   * profiles a MODULE carries itself.
   *
   * Its own field and not part of `files`, because the two are different things to a surface:
   * `files` is the module's definition (its nodes, its panel, its shelf), and these are the
   * material it loads. A tree draws these as the module's children and drops new ones in;
   * nothing offers to create one, since they arrive as bytes.
   *
   * `assets/`-relative POSIX paths, NESTED — a NAM pack is a folder per amp, so flattening
   * would be inventing a shape the disk does not have. A path ending in `/` is a folder that
   * holds nothing: the one thing no other path would mention. See scan.ts's `assetsOf`.
   */
  assets?: string[];
  /** A SONG's alternative versions, as its sidecar declares them. Its own field for the
   *  same reason `assets` is: `meta` is flat scalars, and these are a list of records. Absent
   *  when the sidecar declares none, which is the overwhelming majority. See docs/variants.md. */
  variants?: SongVariant[];
  /** Family-specific extras, all optional: artist/title for a song, the pack for a
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
