// hunt.ts — the contract for pl8's "trouver des morceaux": one row of the search history, as
// the backend writes it and the screen draws it. Here rather than in either half because both
// read the same rows. See apps/pl8/docs/hunt.md.

/** The four states, and the three colours the history draws them in: `done` green,
 *  `searching` and `downloading` blue, `failed` red. */
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
  /** Where it landed, mediatek-relative, once filed. */
  path?: string;
  /** What was actually taken — `.flac`, or the kbps of a lossy one. Recorded because a song
   *  filed at 128 that SAYS so will not be mistaken for a mixing reference six months later. */
  format?: string;
  bitrate?: number | null;
  /** The peer serving it, and how many have been tried. Both shown: "queued behind forty" and
   *  "nobody will send it" are different waits and want different patience. */
  peer?: string;
  switches?: number;
  /** How it was fetched. Absent means the ordinary path, Soulseek through slskd; `youtube` is
   *  the fallback somebody asked for after that came back empty-handed. */
  via?: "youtube";
  /**
   * Was Soulseek asked and EXHAUSTED?
   *
   * True in three cases only: nobody shared the song in a usable format, no peer started sending,
   * or there were none left to try. That is what tells "the network does not have it" apart from
   * every other failure — missing configuration, a service restart, a cancelled search, a file
   * missing over SFTP — which say nothing about availability and call for another fix.
   */
  exhausted?: boolean;
  /** Why it failed — or, on a `done` row, why there was nothing to do. */
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * Does the YouTube fallback make sense on this row?
 *
 * Here, in the contract, because both ends must share one definition: the screen decides to show
 * the button, the route decides to accept the click, and the two answers must agree — a visible
 * button the route would refuse is a dead end.
 *
 * A red row is NOT enough. A restarted service, a cancelled search, a downloaded file that could
 * not be fetched over SFTP: in those three cases Soulseek said nothing about availability, and
 * going to YouTube would answer a question nobody asked — worse, in the SFTP case, it would hide
 * a configuration fault behind a lower-quality file.
 */
export function canFallBackToYoutube(h: HuntRecord): boolean {
  return h.status === "failed" && h.exhausted === true;
}

/** What `GET /api/hunt` answers. `configured` rides along so the screen can draw its own
 *  absence: a button that opened a field and then failed on every query would be worse than
 *  one that says which variables are missing. */
export interface HuntList {
  configured: boolean;
  reason: string | null;
  /** Whether the YouTube fallback is available at all — yt-dlp being a binary in the image
   *  rather than a setting, a failed row otherwise offers a button that cannot work. */
  youtube: boolean;
  hunts: HuntRecord[];
}
