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

/** The sidecar that makes a folder a SONG and carries its provenance and variants — the music's own facts are the master's tags. */
export const SONG_FILE = "song.yaml";

/** What a song's master carries in its tags (ID3, Vorbis comments, MP4 atoms…) — see docs/songs.md. */
export interface MasterTags {
  title?: string;
  artist?: string;
  album?: string;
  bpm?: number;
  /** `C# minor`, `A major` — the key's name, never its Camelot code. */
  key?: string;
  /** The position on its album — `3` out of a `3/12` frame; what orders an album's songs in the tree. */
  track?: number;
}

/** The rest of a master's tags, by TagLib's name for each (`genre`, `date`, `ENCODER`…), every value kept. */
export type OtherTags = Record<string, string[]>;

/** A song's lyrics beside its master: a chord sheet, timecodes inline — docs/songbook.md. */
export const LYRICS_FILE = "lyrics.txt";

/** …its tablature, as plain text. */
export const TABS_FILE = "tabs.txt";

/** …and its CHORDS: lyrics with chords, typed by hand, kept apart from the lyrics for now — docs/songbook.md. */
export const CHORDS_FILE = "chords.txt";

/** …and its sheet music, one file each, ordered by the sidecar's `songbook.sheets`. */
export const SHEETS_DIR = "sheets";

/** One sheet of a song: `file` is folder-relative, `id` what a URL names it by. */
export interface SongbookSheet {
  id: string;
  file: string;
  name: string;
  mime: string;
}

/** Where the songbook's fetch pipeline stands for a song, kept so a reload resumes it. */
export interface SongbookFetch {
  phase: string;
  progress: number | null;
  error: string;
  huntId: string;
  jobId: string;
}

/** What the sidecar's `songbook:` section holds — the song's bookkeeping, never its music. */
export interface SongbookFacts {
  owner: string;
  createdAt: string;
  /** The server a paired machine copied this song from; "" for one of its own. */
  origin: string;
  lyricsMatch: string;
  /** How the chords took the lyrics' times: "matched", "unmatched", or "" with nothing timed to take them from. */
  chordsMatch: string;
  fetchIgnored: boolean;
  fetch: SongbookFetch;
  /** A library path to the instrumental, "" for none. */
  instrumental: string;
  sheets: SongbookSheet[];
}

/** A songbook song read whole: its folder, its texts, its master and its bookkeeping. */
export interface SongbookSong {
  /** The sidecar's `uuid`, the song's id everywhere outside the library. */
  id: string;
  /** Its folder, mediatek-relative. */
  path: string;
  artist: string;
  title: string;
  lyrics: string;
  tablature: string;
  chords: string;
  /** The master's mediatek-relative path, null for a folder holding no audio. */
  master: string | null;
  facts: SongbookFacts;
}

/** The shape a key is stored in, checked on every write path. */
export const KEY_PATTERN = /^[A-G]#?\s+(major|minor)$/;

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
