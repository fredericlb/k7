// The in-memory session shapes every consumer expects. The SPAs read these
// field names over the wire, so they are part of the public contract and
// cannot be renamed on this side alone.

/** A single audio track inside a fusion/multi song. */
export interface Track {
  artist?: string;
  title?: string;
  path?: string;
  from?: number;
  to?: number;
  fullSong?: string;
  /** Grist-only: youtubeId — editor-facing, never serialized to clients. */
  youtubeId?: string;
  effects?: Record<string, number>;
  /** Grist-only, not serialized: it splits a song's tracks into questions and reveal originals. */
  type?: string;
}

/** A single song in a blindtest category. */
export interface Song {
  artist: string;
  title: string;
  path?: string;
  label?: string;
  notice?: string;
  from?: number;
  to?: number;
  fullSong?: string;
  youtubeId?: string;
  effects?: Record<string, number>;
  tracks?: Track[];
  /** Editor review state: "valid" | "to_replace" | "" (= unverified). */
  status?: string;
  /** Overrides the default "<artist> <title>" expected answer in solo mode. */
  answer?: string;
  /** Multiplayer-only; solo mode filters these out. */
  liveOnly?: boolean;
}

/** A themed group of songs. */
export interface Category {
  name: string;
  mode?: string;
  notice?: string;
  illustration: string;
  /** Grist-only variant filter (see Track.type). Not serialized. */
  trackType?: string;
  /** Multiplayer-only; solo mode drops the whole category. */
  liveOnly?: boolean;
  songs: Song[];
}

/** One slot in the session play order: a category slice or a pause. */
export interface OrderEntry {
  cat?: string;
  from?: number;
  to?: number;
  type?: string;
}

/** A full blindtest session. */
export interface Session {
  categories: Category[];
  order?: OrderEntry[];
  /** Per-session guest password; never serialized to clients. */
  guestPassword?: string;
}
