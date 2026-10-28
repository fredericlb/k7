// The collections the rehearsal store holds and the fields of each: what a row reads as when a field
// was never set, and what the PocketBase import copies. A field is added here and nowhere else.

interface FieldSpec {
  name: string;
  type: "text" | "number" | "bool";
}

export type CollectionSchema = Record<string, readonly FieldSpec[]>;

// Collections the store no longer holds: their rows, left in an older file, are dropped when it opens.
export const RETIRED_COLLECTIONS = ["Highlights", "Songs", "SongFavorites"];

const COLLECTIONS = {
  Sessions: [
    { name: "Uid", type: "text" },
    { name: "OwnerId", type: "text" },
    { name: "CreatedAt", type: "text" },
    { name: "Duration", type: "number" },
    { name: "HasRecording", type: "bool" },
    { name: "RecordingMime", type: "text" },
    { name: "RecordingPath", type: "text" },
    { name: "Envelope", type: "text" },
    { name: "Gain", type: "number" },
  ],
  Comments: [
    { name: "SessionUid", type: "text" },
    { name: "OwnerId", type: "text" },
    { name: "StartSec", type: "number" },
    { name: "EndSec", type: "number" },
    { name: "Text", type: "text" },
    { name: "Tags", type: "text" },
    { name: "CreatedAt", type: "text" },
    { name: "Validated", type: "bool" },
    { name: "ClipPath", type: "text" },
    { name: "Envelope", type: "text" },
    // A moment shared from a machine whose session stayed there: the session's date, its label — ../docs/momentShare.md.
    { name: "SessionCreatedAt", type: "text" },
    // The machine a shared moment came from; set, the moment is read-only here — ../docs/momentShare.md.
    { name: "SharedFrom", type: "text" },
  ],
  Markers: [
    { name: "SessionUid", type: "text" },
    { name: "MomentId", type: "text" },
    { name: "OwnerId", type: "text" },
    { name: "AtSec", type: "number" },
    { name: "Comment", type: "text" },
    { name: "CreatedAt", type: "text" },
  ],
  Releases: [
    { name: "Uid", type: "text" },
    { name: "OwnerId", type: "text" },
    { name: "Title", type: "text" },
    { name: "Artist", type: "text" },
    { name: "ReleaseDate", type: "text" },
    { name: "Description", type: "text" },
    { name: "CanDownload", type: "bool" },
    { name: "SongUuid", type: "text" },
    { name: "CreatedAt", type: "text" },
  ],
  Versions: [
    { name: "Uid", type: "text" },
    { name: "ReleaseUid", type: "text" },
    { name: "Name", type: "text" },
    { name: "AudioPath", type: "text" },
    { name: "AudioMime", type: "text" },
    // Its shape, measured once so the waveform draws without decoding it.
    { name: "Envelope", type: "text" },
    { name: "TrackMeta", type: "text" },
    { name: "IsDefault", type: "bool" },
    // Left out of a page's version dropdown — ../docs/pages.md.
    { name: "Hidden", type: "bool" },
    { name: "CreatedAt", type: "text" },
  ],
  Pages: [
    { name: "Uid", type: "text" },
    { name: "OwnerId", type: "text" },
    { name: "Nametag", type: "text" },
    { name: "ReleaseUids", type: "text" },
    // JSON { releaseUid: versionUid }: the version a page plays instead of the default.
    { name: "VersionChoices", type: "text" },
    // "public" | "authenticated" | "private"; empty, on a row older than the field, reads as public — ../docs/pages.md.
    { name: "Visibility", type: "text" },
    { name: "CreatedAt", type: "text" },
  ],
  SingingExercises: [
    { name: "Uid", type: "text" },
    { name: "OwnerId", type: "text" },
    { name: "Title", type: "text" },
    { name: "Description", type: "text" },
    { name: "VideoUrl", type: "text" },
    { name: "CreatedAt", type: "text" },
  ],
} as const satisfies CollectionSchema;

export const SCHEMA: CollectionSchema = COLLECTIONS;

/** A collection the store holds, by name. */
export type Collection = keyof typeof COLLECTIONS;

type FieldValue<T extends FieldSpec["type"]> = T extends "text"
  ? string
  : T extends "number"
    ? number
    : boolean;

/** A row's fields as the store reads them back, every one present: what was never set reads as its zero value. */
export type FieldsOf<C extends Collection> = {
  [F in (typeof COLLECTIONS)[C][number] as F["name"]]: FieldValue<F["type"]>;
};
