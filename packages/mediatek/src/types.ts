// types.ts — what the mediatek catalogue hands out. Types only, shared by the scan, the
// HTTP routes and every surface that lists the library.

/** The two things the mediatek holds — bytes nobody edits in a text editor, see docs/index.md. */
export type Family = "songs" | "samples";

export const FAMILIES: readonly Family[] = ["songs", "samples"];

/** Narrow an untrusted query value to a Family, or undefined — once, not once per HTTP shell. */
export const asFamily = (v: unknown): Family | undefined =>
  FAMILIES.includes(v as Family) ? (v as Family) : undefined;

/** What to tell a caller that named something else — the sentence, not the `{error}` wrapper. */
export const FAMILY_ERROR = `family must be one of: ${FAMILIES.join(", ")}`;

/** The raw capture zone — one word for its folder, its revision key, its count and its tab; see docs/recordings.md. */
export const RECORDINGS_DIR = "recordings";

/** The set lists this volume holds, `playlists/<name>.yaml` — a root zone, not a family; see docs/playlists.md. */
export const PLAYLISTS_DIR = "playlists";

/** The one artist every rehearsal release is published under, `songs/K7/` — the scan keeps it out of the listing; see docs/songs.md. */
export const K7_ARTIST = "K7";

/** The sidecar that makes a folder a SONG and carries its title, provenance and variants. */
export const SONG_FILE = "song.yaml";

// A PLAYLIST needs no such marker — it IS its file; the rule and the parser are `@studio/song/playlist`.

/** One alternative version of a song, declared in its sidecar. See docs/variants.md. */
export interface SongVariant {
  /** What the sidecar calls it — the key, and what a surface shows. */
  name: string;
  /** What it names, verbatim: a file beside the master. */
  ref: string;
  /** Whether that file is actually THERE — the folder settles it, see docs/variants.md. */
  kind: "file" | "missing";
}

/** One catalogued thing — deliberately flat, with the family-specific detail in `kind` and `meta`. */
export interface MediatekEntry {
  family: Family;
  /** Stable id: the entry's mediatek-relative POSIX path — nothing else survives a rescan. */
  id: string;
  /** What to show. The title from a sidecar when there is one, else the file/folder name. */
  name: string;
  /** Mediatek-relative POSIX path — to the folder for a song or a module, to the file for a sample. */
  path: string;
  /** The family's own subdivision — "audio" | "video" for samples, and "" for a song, which does not divide (docs/songs.md). */
  kind: string;
  /** Bytes of the entry's payload — the master for a song, the file for a sample. Absent for a module. */
  bytes?: number;
  /** Newest mtime under the entry, ms since epoch. What a surface sorts "recent" by. */
  mtime: number;
  /** A SONG's alternative versions, as its sidecar declares them — `meta` holds only scalars (docs/variants.md). */
  variants?: SongVariant[];
  /** Family-specific extras, all optional: artist/master/bpm for a song, the pack for a sample. */
  meta?: Record<string, string | number | boolean>;
}

/** A whole family's listing plus the token it was read at. */
export interface FamilyListing {
  family: Family;
  rev: string;
  entries: MediatekEntry[];
  /** Family-relative paths NO entry accounts for — an empty folder, a loose file; see scanUnlisted. */
  unlisted: string[];
}

/** A paired machine's library against its server's, matched by path — see docs/serverCopy.md. */
export interface LibraryPlacement {
  /** False when this machine is paired with no server, or IS the server: nothing to say then. */
  paired: boolean;
  /** The server's origin, for a tooltip. */
  server: string | null;
  /** This family's local paths the server holds too. */
  synced: string[];
  /** The server's entries this machine lacks — what a download brings down. */
  serverOnly: MediatekEntry[];
}
