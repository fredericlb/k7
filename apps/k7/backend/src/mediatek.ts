// mediatek.ts — où vivent les octets d'une séance : la zone RECORDINGS de la médiathèque,
// par HTTP. Grist garde les métadonnées (durée, enveloppe, gain, moments) et ne porte plus
// l'audio. Le client est celui du package, pas un second écrit ici. Voir docs/audio.md.

import {
  pushMorceau,
  pushRecording,
  type RemoteConfig,
  remoteLibrary,
  remoteWriter,
} from "@studio/mediatek/remote";
import { env } from "./env.ts";

const cfg = (): RemoteConfig => ({
  base: env.mediatek.base,
  token: env.mediatek.token,
});

/**
 * L'extension sous laquelle la médiathèque acceptera ces octets.
 *
 * `mp4` est le piège : le navigateur de Safari enregistre en `audio/mp4`, que la
 * médiathèque classe en VIDÉO — la zone refuserait le fichier. Un mp4 sans image est un
 * `.m4a`, c'est le même conteneur, et c'est ce nom-là qui dit la vérité.
 */
export function zoneExt(ext: string): string {
  return ext === "mp4" ? "m4a" : ext;
}

/**
 * Envoie une capture ; la médiathèque décide du nom.
 *
 * `at` est l'heure d'enregistrement de la séance, pas celle de l'envoi : une séance
 * rapatriée le lendemain se rangerait sinon, entière, sous la mauvaise date.
 */
export async function push(
  bytes: Uint8Array,
  ext: string,
  at?: Date,
): Promise<string> {
  const { path } = await pushRecording(cfg(), {
    filename: `take.${zoneExt(ext)}`,
    bytes,
    at,
  });
  return path;
}

/**
 * Envoie un MOMENT : le même dossier de jour que les captures, nommé comme un extrait.
 *
 * `at` est l'instant où l'extrait a été JOUÉ — le début de la séance plus sa position
 * dedans — et non l'instant où quelqu'un l'a annoté, qui peut être trois jours plus tard.
 * La zone range par heure de jeu ; un moment n'y fait pas exception.
 */
export async function pushMoment(
  bytes: Uint8Array,
  ext: string,
  opts: { at?: Date; durationSec: number; label?: string },
): Promise<string> {
  const { path } = await pushRecording(cfg(), {
    filename: `moment.${zoneExt(ext)}`,
    bytes,
    at: opts.at,
    durationSec: opts.durationSec,
    label: opts.label,
  });
  return path;
}

/**
 * Envoie une VERSION PUBLIÉE dans les morceaux, sous l'artiste `K7`.
 *
 * `recorded` et non `imported` : c'est le studio qui l'a produite, et cette distinction
 * décide de ce qui peut être re-fabriqué et de ce qui est le master de quelqu'un d'autre.
 * `replace` est vrai parce que republier une version est un remplacement voulu — le 409 de
 * la médiathèque protège une personne qui envoie deux fois, pas un service qui republie.
 */
export async function pushVersion(
  bytes: Uint8Array,
  ext: string,
  tags: { album: string; title: string },
): Promise<string> {
  // The MASTER's path, not the folder's: it is what a caller has to fetch to play the
  // version, and the folder is one `dirname` away when the stems need it.
  const { master } = await pushMorceau(cfg(), {
    filename: `mixdown.${zoneExt(ext)}`,
    bytes,
    artist: ARTIST,
    album: tags.album,
    title: tags.title,
    kind: "recorded",
    source: "k7",
    replace: true,
  });
  return master;
}

/** L'artiste sous lequel k7 publie. Un seul, décidé ici : la médiathèque range par
 *  artiste, et « qui a joué » vit dans les métadonnées de la release. */
export const ARTIST = "K7";

/** Écrit un fichier à un chemin choisi — les stems d'une version, le sidecar d'un morceau
 *  qu'un renommage a rendu faux. Réservé à ce que ce service a lui-même créé. */
export async function putFile(
  path: string,
  body: Uint8Array | string,
): Promise<void> {
  await remoteWriter(cfg()).put(path, body);
}

/** Un dossier entier — ce qu'est une version publiée : un master, ses stems, son sidecar. */
export async function removeTree(path: string): Promise<void> {
  await remoteWriter(cfg()).removeTree(path);
}

/** Réécrit une capture EXISTANTE, à son chemin. Une séance qu'on prolonge reste une
 *  séance : un second fichier laisserait deux prises là où il n'y a qu'un enregistrement. */
export async function replace(path: string, bytes: Uint8Array): Promise<void> {
  await remoteWriter(cfg()).put(path, bytes);
}

/** Absent vaut succès, côté médiathèque comme ici. */
export async function remove(path: string): Promise<void> {
  await remoteWriter(cfg()).remove(path);
}

/** Rapatrie les octets dans le cache disque, d'où ils se diffusent en Range. */
export async function download(path: string, dest: string): Promise<void> {
  await remoteLibrary(cfg()).download(path, dest);
}
