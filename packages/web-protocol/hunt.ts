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
  /** How it was fetched. Absent means the ordinary path, Soulseek through slskd; `youtube` is
   *  the fallback somebody asked for after that came back empty-handed. */
  via?: "youtube";
  /**
   * The playlist to append the song to once it is filed, mediatek-relative.
   *
   * Carried on the ROW rather than read when the download finishes. A hunt runs for minutes,
   * and the menu on screen belongs to the next one: four searches started and then the choice
   * changed would otherwise all land in the last playlist picked, which is nobody's intent.
   */
  playlist?: string;
  /**
   * Soulseek a-t-il été interrogé et ÉPUISÉ ?
   *
   * Vrai dans trois cas seulement : personne ne partageait le morceau dans un format
   * utilisable, aucun pair n'a commencé à envoyer, ou il n'en restait plus à essayer. C'est ce
   * qui distingue « le réseau n'a pas le morceau » de tous les autres échecs — configuration
   * absente, redémarrage du service, recherche annulée, fichier introuvable en SFTP — qui ne
   * disent rien sur la disponibilité du morceau et appellent une autre correction.
   */
  exhausted?: boolean;
  /** Why it failed — or, on a `done` row, why there was nothing to do. */
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * Le secours YouTube a-t-il un sens sur cette ligne ?
 *
 * Ici, dans le contrat, parce que les deux bouts doivent en avoir la même définition : l'écran
 * décide d'afficher le bouton, la route décide d'accepter le clic, et les deux réponses
 * doivent être la même — un bouton visible que la route refuserait serait une impasse.
 *
 * Il ne suffit PAS que la ligne soit rouge. Un service redémarré, une recherche annulée, un
 * fichier téléchargé qu'on n'a pas su récupérer en SFTP : dans ces trois cas Soulseek n'a rien
 * dit sur la disponibilité du morceau, et aller sur YouTube répondrait à une question qui n'a
 * pas été posée — pire, dans le cas SFTP, ça masquerait un défaut de configuration derrière un
 * fichier de moins bonne qualité.
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
