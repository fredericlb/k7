// Domain models shared between the backend (API responses) and the frontend
// (API consumers). This is the single source of truth for the API contract;
// the frontend re-exports these from its own types module.

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
  // Stable id of the originating st0 song (set when uploaded via the CLI).
  songUuid?: string | null;
  // Present on the detail endpoint, not on the list endpoint.
  versions?: ReleaseVersion[];
  defaultVersionId?: string | null;
}

export interface Page {
  id: string;
  nametag: string;
  releaseIds: string[];
  createdAt: string;
  releases?: Release[]; // resolved on the detail endpoint
}

// One file of a song's sheet music, which is a PDF or images rather than text.
export interface SheetFile {
  id: string;
  name: string;
  mime: string; // e.g. "application/pdf", "image/png", "image/jpeg"
}

export interface Song {
  id: string;
  artist: string;
  title: string;
  lyrics: string;
  tablature: string;
  // Ordered list of sheet-music files (one PDF, several images, or a mix).
  sheets: SheetFile[];
  favorite: boolean;
  createdAt: string;
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

export interface Envelope {
  intervalMs: number;
  samples: number[];
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
