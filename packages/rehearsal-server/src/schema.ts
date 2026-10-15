// The collections the rehearsal store holds and the fields of each: what a row reads as when a field
// was never set, and what the PocketBase import copies. A field is added here and nowhere else.

export interface FieldSpec {
  name: string;
  type: "text" | "number" | "bool";
}

export type CollectionSchema = Record<string, FieldSpec[]>;

export const SCHEMA: CollectionSchema = {
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
  Highlights: [
    { name: "SessionUid", type: "text" },
    { name: "StartSec", type: "number" },
    { name: "EndSec", type: "number" },
    { name: "DurationSec", type: "number" },
    { name: "Avg", type: "number" },
    { name: "Peak", type: "number" },
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
  // A song's sheets: SheetMeta orders them, the store's `sheets/` folder holds their bytes.
  Songs: [
    { name: "Uid", type: "text" },
    { name: "OwnerId", type: "text" },
    { name: "Artist", type: "text" },
    { name: "Title", type: "text" },
    { name: "Lyrics", type: "text" },
    { name: "LyricTimings", type: "text" },
    { name: "Tablature", type: "text" },
    { name: "SheetMeta", type: "text" },
    { name: "Envelope", type: "text" },
    { name: "AudioPath", type: "text" },
    { name: "AudioMime", type: "text" },
    { name: "AudioName", type: "text" },
    { name: "InstrumentalPath", type: "text" },
    { name: "InstrumentalMime", type: "text" },
    { name: "InstrumentalName", type: "text" },
    // The auto-fetch pipeline's own state — fetchSong/run.ts's runPipeline reads and writes it.
    { name: "FetchPhase", type: "text" },
    { name: "FetchProgress", type: "number" },
    { name: "FetchError", type: "text" },
    { name: "FetchHuntId", type: "text" },
    { name: "FetchJobId", type: "text" },
    // "" (not attempted), "matched" (applied automatically) or "unmatched" (needs the fixer).
    { name: "LyricsMatch", type: "text" },
    // The insert dismissed on purpose — "Ignore" — so it never offers again for this song.
    { name: "FetchIgnored", type: "bool" },
    // Seen by its creator alone instead of the whole band — ../docs/ownership.md.
    { name: "Private", type: "bool" },
    { name: "CreatedAt", type: "text" },
    // The server a device copied the song from; set, the song is read-only on that device — ../docs/songbookCopy.md.
    { name: "Origin", type: "text" },
  ],
  SongFavorites: [
    { name: "SongUid", type: "text" },
    { name: "OwnerId", type: "text" },
  ],
};
