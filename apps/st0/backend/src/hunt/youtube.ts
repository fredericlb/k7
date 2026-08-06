// youtube.ts — le secours, quand personne sur Soulseek n'a envoyé le morceau : yt-dlp prend la
// première réponse de YouTube. Tourne DANS ce conteneur, qui détient déjà le volume — donc
// aucun transfert, contrairement à slskd. Voir ../../docs/hunt.md.

import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isAudio } from "@studio/mediatek/media";
import { huntsDir } from "./store.ts";

/** Le plafond de la route d'envoi de la médiathèque. Passé à yt-dlp, qui abandonne avant de
 *  télécharger plutôt qu'après. */
const MAX_MB = 512;

/** Une vidéo, ce n'est pas un film : au-delà, yt-dlp est bloqué sur autre chose. */
const TIMEOUT_MS = 5 * 60_000;

const bin = (): string => process.env.YTDLP_BIN || "yt-dlp";

/**
 * Ce qu'on demande à YouTube.
 *
 * L'artiste EST voulu ici, à l'inverse de la recherche Soulseek : un titre de vidéo YouTube
 * s'écrit « Artiste - Titre », donc l'artiste est dans le champ même qu'on interroge. Là-bas il
 * était le dossier au-dessus et n'ajoutait rien ; ici il est la moitié de la réponse.
 */
export function youtubeQuery(tags: {
  artist?: string;
  title?: string;
  query: string;
}): string {
  const named = [tags.artist, tags.title].filter(Boolean).join(" ").trim();
  // Le texte tapé quand MusicBrainz n'a rien reconnu : c'est tout ce qu'on a, et YouTube est
  // bien plus tolérant qu'un catalogue sur une orthographe approximative.
  return named || tags.query.trim();
}

/**
 * Les arguments de yt-dlp, en TABLEAU.
 *
 * Un tableau et jamais une ligne de commande : ce qui est cherché vient de ce que quelqu'un a
 * tapé, et `execFile` sans shell fait de la requête un seul argument, quels que soient les
 * guillemets, points-virgules et `$(…)` qu'elle contient.
 *
 * `--audio-format best` ne convertit PAS — c'est l'inverse : ça garde le codec de la source.
 * YouTube sert de l'Opus autour de 130 kbps, et le ré-encoder en mp3 serait un transcodage
 * lossy vers lossy, nettement pire que l'un ou l'autre, pour rien.
 */
export function ytdlpArgs(query: string, outDir: string): string[] {
  return [
    // `ytsearch1:` est ce qui transforme une phrase en une vidéo sans qu'on ait à interroger
    // YouTube nous-mêmes. Un seul résultat : le deuxième est déjà une reprise ou un live.
    `ytsearch1:${query}`,
    "--no-playlist",
    "--extract-audio",
    "--audio-format",
    "best",
    "--audio-quality",
    "0",
    "--max-filesize",
    `${MAX_MB}M`,
    "--socket-timeout",
    "30",
    "--no-progress",
    "--no-warnings",
    "--output",
    join(outDir, "%(id)s.%(ext)s"),
  ];
}

/** Le seul fichier audio du dossier de sortie, ou null. yt-dlp nomme d'après l'id de la vidéo,
 *  donc on ne peut pas deviner l'extension avant de regarder — c'est le codec qui la donne. */
export function audioIn(dir: string): string | null {
  try {
    return readdirSync(dir).find((f) => isAudio(f)) ?? null;
  } catch {
    return null;
  }
}

let probed: boolean | null = null;

/** yt-dlp est-il là ? Sondé une fois : c'est un binaire dans l'image, il n'apparaît pas en
 *  cours de route, et le demander à chaque affichage de l'historique serait un `spawn` par
 *  interrogation. */
export async function youtubeAvailable(): Promise<boolean> {
  if (probed !== null) return probed;
  probed = await new Promise<boolean>((resolve) => {
    execFile(bin(), ["--version"], { timeout: 10_000 }, (err) => resolve(!err));
  });
  return probed;
}

/**
 * Prendre le morceau sur YouTube.
 *
 * Le dossier de travail est sous `.hunts/tmp/` — sur le volume, donc de la vraie place, et
 * derrière un point, donc invisible aux scans de familles. Effacé quoi qu'il arrive : un
 * téléchargement raté laisserait sinon des octets que plus rien ne nomme.
 */
export async function fetchFromYoutube(
  query: string,
  id: string,
): Promise<{ bytes: Buffer; filename: string }> {
  const dir = join(huntsDir(), "tmp", id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        bin(),
        ytdlpArgs(query, dir),
        { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
        (err, _out, stderr) => {
          if (!err) return resolve();
          // ENOENT est le cas qu'on veut nommer : « pas installé » et « la vidéo a résisté »
          // demandent deux choses différentes à qui lit la ligne rouge.
          if ((err as NodeJS.ErrnoException).code === "ENOENT")
            return reject(
              new Error(`yt-dlp n'est pas installé sur ce serveur (${bin()})`),
            );
          const last = String(stderr || err.message)
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop();
          reject(new Error(`yt-dlp : ${last ?? err.message}`.slice(0, 300)));
        },
      );
    });
    const name = audioIn(dir);
    // Rien d'audio malgré une sortie sans erreur : yt-dlp a rendu un conteneur que la
    // médiathèque ne saurait pas ranger, et `masterName` refuserait de toute façon.
    if (!name)
      throw new Error(
        "yt-dlp n'a produit aucun format audio que la médiathèque accepte",
      );
    return { bytes: readFileSync(join(dir, name)), filename: name };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
