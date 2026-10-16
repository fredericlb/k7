// Domain models shared between the backend (API responses) and the frontend
// (API consumers). This is the single source of truth for the API contract;
// the frontend re-exports these from its own types module.

import type { PageVisibility } from "./pageVisibility.ts";

export type { PageVisibility } from "./pageVisibility.ts";

export interface User {
  sub: string;
  name: string;
  email: string | null;
}

// One stem of a multitrack version; like SheetFile, the id is its download handle.
export interface ReleaseTrack {
  id: string;
  name: string;
  mime: string;
}

export interface ReleaseVersion {
  id: string;
  name: string;
  isDefault: boolean;
  // Left out of a page's version dropdown; the release page still lists it.
  hidden: boolean;
  audioMime: string | null; // the mixdown's mime (the playable file)
  // Per-track stems (empty for web-created, single-file versions).
  tracks: ReleaseTrack[];
  createdAt: string;
}

export interface Release {
  id: string;
  title: string;
  artist: string;
  releaseDate: string | null;
  description: string;
  canDownload: boolean;
  createdAt: string;
  // Stable id of the originating k7 song (set when uploaded via the CLI).
  songUuid?: string | null;
  // Present on the detail endpoint, not on the list endpoint.
  versions?: ReleaseVersion[];
  defaultVersionId?: string | null;
}

/** What the release page can edit; the versions are edited one by one. */
export type ReleasePatch = Partial<
  Pick<
    Release,
    "title" | "artist" | "releaseDate" | "description" | "canDownload"
  >
>;

export interface Page {
  id: string;
  nametag: string;
  releaseIds: string[];
  // The version each release plays on this page; a release absent here plays its default.
  versionIds: Record<string, string>;
  // Who opens it by its nametag — ../rehearsal-server/docs/pages.md.
  visibility: PageVisibility;
  createdAt: string;
  releases?: Release[]; // resolved on the detail endpoint
}

// One file of a song's sheet music, which is a PDF or images rather than text.
export interface SheetFile {
  id: string;
  name: string;
  mime: string; // e.g. "application/pdf", "image/png", "image/jpeg"
}

/** The one recording a song is played along to. The bytes are behind `/audio`. */
export interface SongAudio {
  name: string;
  mime: string;
  /** Where it is in pl8's médiathèque — what the page streams, k7 keeping no copy. */
  path: string;
}

/** One set of timed lyrics found on LRCLIB for a song — ../ui-rehearsal/docs/lyricsTiming.md. */
export interface LrcCandidate {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  /** Seconds, as LRCLIB knows the recording. */
  duration: number;
  /** The LRC text itself; empty for an instrumental. */
  syncedLyrics: string;
  /** LRCLIB lists the recording as having no lyrics at all. */
  instrumental: boolean;
}

/** When one lyric line is sung: its line index in `lyrics`, its normalised text, and seconds. */
export interface LyricTiming {
  line: number;
  text: string;
  t: number;
}

export interface Song {
  id: string;
  artist: string;
  title: string;
  lyrics: string;
  // From an LRC file; re-aligned to the text on display, so an edit keeps the unchanged lines' times.
  lyricTimings: LyricTiming[];
  tablature: string;
  // Ordered list of sheet-music files (one PDF, several images, or a mix).
  sheets: SheetFile[];
  // Null until one is uploaded; a song carries at most one.
  audio: SongAudio | null;
  // The same track without the voice, mixed from pl8's stems; null until "Fetch song" makes one.
  instrumental: SongAudio | null;
  // The auto-fetch pipeline's own state, so a reload finds it where it left off.
  fetchStatus: FetchStatus;
  // "" (not attempted), "matched" (timed automatically), "unmatched" (to time by hand), or "instrumental" (LRCLIB says there are no lyrics).
  lyricsMatch: "" | "matched" | "unmatched" | "instrumental";
  // The fetch insert was dismissed on purpose ("Ignore") — never offer it again for this song.
  fetchIgnored: boolean;
  // Seen by its creator alone; chosen when the song is added — ../rehearsal-server/docs/ownership.md.
  private: boolean;
  // The asking user's own star: the songbook is shared, a favourite is not.
  favorite: boolean;
  // The asking user created it.
  mine: boolean;
  // The asking user may delete it: its creator for a private song, an admin for a public one, anyone for a copy.
  canDelete: boolean;
  // The server this machine copied it from, read-only here; "" for a song of this store's own.
  origin: string;
  createdAt: string;
}

/** Where the auto-fetch pipeline stands — see packages/ui-rehearsal/src/fetchSong/run.ts's runPipeline. */
export interface FetchStatus {
  phase:
    | ""
    | "searching"
    | "downloading"
    | "stemming"
    | "matching-lyrics"
    | "failed";
  // Percent, meaningful during "stemming" only.
  progress: number | null;
  error: string;
  // pl8 ids, kept so a reload can resume polling instead of starting over.
  huntId: string;
  jobId: string;
}

export type SongTab = "lyrics" | "tablature" | "sheet";

export interface Annotation {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  tags: string[];
  validated: boolean;
  createdAt: string;
}

// A moment stands alone, in its own view, and outlives the session it was captured in.
export interface Moment {
  id: string;
  sessionUid: string | null;
  // That session's own createdAt, since sessions have no name; null once it is deleted.
  sessionCreatedAt: string | null;
  sessionAvailable: boolean;
  startSec: number;
  endSec: number;
  text: string;
  tags: string[];
  validated: boolean;
  createdAt: string;
  // The machine it was shared from, read-only here; "" for a moment of this store's own.
  sharedFrom: string;
  // Detail endpoint only: the clip's own envelope and markers, on a timeline starting at 0.
  envelope?: Envelope | null;
  markers?: Marker[];
}

/** A single-timestamp pin on the session timeline, with an optional comment. */
export interface Marker {
  id: string;
  atSec: number;
  comment: string;
  createdAt: string;
}

export interface Session {
  id: string;
  createdAt: string;
  duration: number;
  hasRecording: boolean;
  recordingExt: string | null;
  recordingMime: string | null;
  gain: number; // playback normalization gain
  annotations: Annotation[];
  markers: Marker[];
}

/** One entry of the shared singing practice book: what to sing, and how. */
export interface SingingExercise {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  /** A YouTube link showing it done, or empty — an exercise needs no demo. */
  videoUrl: string;
  /** The asking user wrote it, which is what lets them delete it. */
  mine: boolean;
  createdAt: string;
}

export interface Envelope {
  intervalMs: number;
  samples: number[];
}

/** A song's envelope and the length its buckets cover — a waveform needs both. */
export interface SongEnvelope extends Envelope {
  seconds: number;
  /** Onsets pl8 detected, in file seconds — drawn as backdrop rules, same as ui-waveform's own. */
  onsets?: number[];
}

export interface DetectedEvent {
  startSec: number;
  endSec: number;
  durationSec: number;
  avg: number;
  peak: number;
}

export interface EventsResult {
  threshold: number;
  minSilenceSec: number;
  peak: number;
  events: DetectedEvent[];
}

/** A songbook row: what the list shows of a song, never its texts — ../rehearsal-server/docs/store.md. */
export interface SongListEntry {
  id: string;
  artist: string;
  title: string;
  hasLyrics: boolean;
  hasTablature: boolean;
  sheetCount: number;
  private: boolean;
  favorite: boolean;
  mine: boolean;
  canDelete: boolean;
  origin: string;
  createdAt: string;
}

/** A songbook song as a paired machine lists the server's: enough to name it. */
export interface SongSummary {
  id: string;
  artist: string;
  title: string;
  private: boolean;
}

/** A paired machine's songbook against its server's, by song id — ../rehearsal-server/docs/songbookCopy.md. */
export interface SongbookPlacement {
  /** False when this machine is paired with no server, or IS the server. */
  paired: boolean;
  /** The server's origin, for a tooltip. */
  server: string | null;
  /** This machine's song ids the server holds too. */
  synced: string[];
  /** The server's public songs this machine lacks. */
  serverOnly: SongSummary[];
}

/** Which of a paired machine's moments its server holds, by moment id — ../rehearsal-server/docs/momentShare.md. */
export interface MomentPlacement {
  /** False when this machine is paired with no server, or IS the server. */
  paired: boolean;
  /** The server's origin, for a tooltip. */
  server: string | null;
  /** This machine's moment ids the server holds a copy of. */
  shared: string[];
}

/** Whether releases and pages can be reached from here: they live on the server alone — ../rehearsal-server/docs/publications.md. */
export interface PublicationsStatus {
  available: boolean;
  /** Why not: no server paired, the server not answering, or a pairing too old to name a person. */
  reason?: "unpaired" | "unreachable" | "repair";
  /** The server's origin, for the sentence that says so. */
  server?: string | null;
}
