// The PocketBase collections this app owns. Field names mirror the old Grist
// columns 1:1, so migratePocketbaseData.ts can copy rows across unchanged.
// migrate.ts applies this; migratePocketbaseData.ts uses TABLES to know what
// to copy and which stray Grist columns (e.g. a retired "Favorite") to drop.

import type { CollectionSchema } from "./pocketbase.ts";

export const SCHEMA: CollectionSchema = {
  Sessions: [
    { name: "Uid", type: "text", required: true },
    { name: "OwnerId", type: "text", required: true },
    { name: "CreatedAt", type: "text" },
    { name: "Duration", type: "number" },
    { name: "HasRecording", type: "bool" },
    { name: "RecordingMime", type: "text" },
    { name: "RecordingPath", type: "text" },
    { name: "Envelope", type: "text" },
    { name: "Gain", type: "number" },
  ],
  Highlights: [
    { name: "SessionUid", type: "text", required: true },
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
    { name: "Uid", type: "text", required: true },
    { name: "OwnerId", type: "text", required: true },
    { name: "Title", type: "text" },
    { name: "Artist", type: "text" },
    { name: "ReleaseDate", type: "text" },
    { name: "Description", type: "text" },
    { name: "CanDownload", type: "bool" },
    { name: "SongUuid", type: "text" },
    { name: "CreatedAt", type: "text" },
  ],
  Versions: [
    { name: "Uid", type: "text", required: true },
    { name: "ReleaseUid", type: "text", required: true },
    { name: "Name", type: "text" },
    { name: "AudioPath", type: "text" },
    { name: "AudioMime", type: "text" },
    // Its shape, measured once so the waveform draws without decoding it.
    { name: "Envelope", type: "text" },
    { name: "TrackMeta", type: "text" },
    { name: "IsDefault", type: "bool" },
    // Left out of a page's version dropdown — ../../docs/pages.md.
    { name: "Hidden", type: "bool" },
    { name: "CreatedAt", type: "text" },
  ],
  Pages: [
    { name: "Uid", type: "text", required: true },
    { name: "OwnerId", type: "text", required: true },
    { name: "Nametag", type: "text" },
    { name: "ReleaseUids", type: "text" },
    // JSON { releaseUid: versionUid }: the version a page plays instead of the default.
    { name: "VersionChoices", type: "text" },
    { name: "CreatedAt", type: "text" },
  ],
  SingingExercises: [
    { name: "Uid", type: "text", required: true },
    { name: "OwnerId", type: "text", required: true },
    { name: "Title", type: "text" },
    { name: "Description", type: "text" },
    { name: "VideoUrl", type: "text" },
    { name: "CreatedAt", type: "text" },
  ],
  // SheetFiles (Grist's own attachment-list UI column) has no PocketBase
  // equivalent; SheetMeta plus the song_sheets collection replace it.
  Songs: [
    { name: "Uid", type: "text", required: true },
    { name: "OwnerId", type: "text", required: true },
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
    // Seen by its creator alone instead of the whole band — ../../docs/ownership.md.
    { name: "Private", type: "bool" },
    { name: "CreatedAt", type: "text" },
  ],
  SongFavorites: [
    { name: "SongUid", type: "text", required: true },
    { name: "OwnerId", type: "text", required: true },
  ],
  SupernoteSync: [
    { name: "OwnerId", type: "text", required: true },
    { name: "Enabled", type: "bool" },
    { name: "BaseUrl", type: "text" },
    { name: "Account", type: "text" },
    { name: "Secret", type: "text" },
    { name: "LastSyncAt", type: "text" },
    { name: "LastStatus", type: "text" },
    { name: "LastCount", type: "number" },
    { name: "Pushed", type: "text" },
  ],
};

export const TABLES = Object.keys(SCHEMA);
