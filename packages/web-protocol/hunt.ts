// hunt.ts — the contract for st0's "trouver des morceaux": one row of the search history, as
// the backend writes it and the screen draws it. Here rather than in either half because both
// read the same rows. See apps/st0/docs/hunt.md.

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
  /** Why it failed — or, on a `done` row, why there was nothing to do. */
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/** What `GET /api/hunt` answers. `configured` rides along so the screen can draw its own
 *  absence: a button that opened a field and then failed on every query would be worse than
 *  one that says which variables are missing. */
export interface HuntList {
  configured: boolean;
  reason: string | null;
  hunts: HuntRecord[];
}
