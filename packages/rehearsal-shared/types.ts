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
  /** Per-bucket peak, the height of a spectrum column, and the three band peaks it is coloured by. */
  peak?: number[];
  low?: number[];
  mid?: number[];
  high?: number[];
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
