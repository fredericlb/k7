// hunt.ts — the contract for pl8's "trouver des morceaux": one row of the search history, as
// the backend writes it and the screen draws it. Here rather than in either half because both
// read the same rows. See apps/k7/backend/docs/media/hunt.md.

/** Four states in three colours: `done` green, `searching` and `downloading` blue, `failed` red. */
export type HuntStatus = "searching" | "downloading" | "done" | "failed";

export interface HuntRecord {
  id: string;
  /** What was typed. Kept verbatim — it is the row's title until MusicBrainz answers. */
  query: string;
  status: HuntStatus;
  artist?: string;
  title?: string;
  album?: string;
  /** The release date of the album named above, for telling two records apart. */
  date?: string;
  /** The names the CALLER chose to file it under, album unknown; absent, the tags above decide the folder. */
  fileAs?: HuntFileAs;
  /** Where it landed, mediatek-relative, once filed. */
  path?: string;
  /** What was actually taken — `.flac`, or the kbps of a lossy one; see docs/hunt.md. */
  format?: string;
  bitrate?: number | null;
  /** The peer serving it, and how many have been tried — two different waits; see docs/hunt.md. */
  peer?: string;
  switches?: number;
  /** How it was fetched; absent means the ordinary path, Soulseek through slskd. */
  via?: "youtube";
  /** Was Soulseek asked and EXHAUSTED? Three cases only, and not the same as failing — docs/hunt.md. */
  exhausted?: boolean;
  /** Why it failed — or, on a `done` row, why there was nothing to do. */
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/** What a hunt files its download under, as MusicBrainz (or Deezer) identified the query. */
export interface HuntTags {
  artist: string;
  title: string;
  album: string | null;
  date: string | null;
}

/** The names a hunt files under when the caller typed them: the médiathèque's "Add a song" — docs/hunt.md. */
export interface HuntFileAs {
  artist: string;
  title: string;
}

/** What `GET /api/hunt/identify` answers: the recording a query would hunt, or null for none. */
export interface HuntIdentity {
  tags: HuntTags | null;
}

/** Does the YouTube fallback make sense here? A red row is NOT enough — see docs/hunt.md. */
export function canFallBackToYoutube(h: HuntRecord): boolean {
  return h.status === "failed" && h.exhausted === true;
}

/** A half of the download's settings still blank: the slskd daemon, or the SFTP side that fetches its files. */
export type HuntSettingsGap = "slskd" | "sftp";

/** What `GET /api/hunt` answers; `configured` rides along so the screen can draw its own absence. */
export interface HuntList {
  configured: boolean;
  /** The server's own sentence, a fallback for a screen that does not know the gaps below. */
  reason: string | null;
  /** What is blank, so the screen says it in its own language — empty when configured. */
  missing: HuntSettingsGap[];
  /** Whether the YouTube fallback is available at all — yt-dlp is a binary, not a setting. */
  youtube: boolean;
  hunts: HuntRecord[];
}
