// Domain models shared between the backend (API responses) and the frontend
// (API consumers). This is the single source of truth for the API contract;
// the frontend re-exports these from its own types module.

export interface User {
  sub: string;
  name: string;
  email: string | null;
}

// One stem of a multitrack version — a single audio file (one rendered track).
// Mirrors SheetFile: the id is the file's handle for the download endpoint.
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
  // Stable id of the originating pistes song (set when uploaded via the CLI).
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

// A single file backing a song's sheet music. A sheet is not text — it is a PDF
// or a set of images, so a song carries an ordered list of these. The `id` is
// the file's stable handle for the download / delete endpoints.
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

// A moment as a standalone entity (its own view), independent of the session it
// was captured in — which may since have been deleted.
export interface Moment {
  id: string;
  sessionUid: string | null;
  // The originating session's recording date/time (its createdAt), for display —
  // sessions have no name. Null when that session has since been deleted.
  sessionCreatedAt: string | null;
  sessionAvailable: boolean;
  startSec: number;
  endSec: number;
  text: string;
  tags: string[];
  validated: boolean;
  createdAt: string;
  // Present on the detail endpoint (not on the list): the clip's own waveform
  // envelope and its markers, on a clip-relative timeline starting at 0.
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
