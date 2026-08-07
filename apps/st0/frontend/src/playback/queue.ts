// queue.ts — ce qu'on a mis à la suite. Les opérations sont pures et à part : réordonner une
// liste est exactement le genre de code qui se trompe d'un cran, et un lecteur qui perd la
// piste qu'on vient de déplacer n'est pas crédible. Voir ../../docs/miniPlayer.md.

import type { MediatekEntry } from "@studio/mediatek/types";

/**
 * Un morceau en attente.
 *
 * L'ENTRÉE et non un chemin résolu : où le fichier se joue dépend de la machine choisie et de
 * son cache, deux choses qui peuvent changer entre le moment où on l'ajoute et celui où il
 * passe. On garde donc ce qui est stable et on résout au dernier moment.
 */
export interface QueueItem {
  /** L'identité de la ligne, et ce qui empêche un doublon : le chemin du morceau. */
  id: string;
  entry: MediatekEntry;
}

/**
 * Ajouter à la suite, sans doublon.
 *
 * Un morceau déjà en attente n'est pas remis : « ajouter » deux fois est presque toujours un
 * second clic sur la même ligne, et une file qui joue deux fois le même titre à la suite est
 * un défaut que personne n'attribue au clic.
 */
export function enqueue(
  queue: QueueItem[],
  entries: MediatekEntry[],
): QueueItem[] {
  const held = new Set(queue.map((q) => q.id));
  const added = entries
    .filter((e) => !held.has(e.path))
    .map((e) => ({ id: e.path, entry: e }));
  return added.length ? [...queue, ...added] : queue;
}

/** Retirer la ligne d'indice `i`. Hors bornes rend la même file — un identifiant périmé n'est
 *  pas une faute, c'est un clic sur ce qui vient d'être joué. */
export function removeAt(queue: QueueItem[], i: number): QueueItem[] {
  if (i < 0 || i >= queue.length) return queue;
  return [...queue.slice(0, i), ...queue.slice(i + 1)];
}

/**
 * Déplacer la ligne `from` à la position `to`.
 *
 * `to` est l'indice VOULU dans la liste finale, pas dans la liste de départ. C'est la
 * différence qui fait qu'un déplacement vers le bas semble ne rien faire quand on la rate :
 * retirer d'abord décale tout ce qui suit, donc l'insertion doit se faire dans la liste déjà
 * amputée. Testé dans les deux sens pour cette raison.
 */
export function moveTo(
  queue: QueueItem[],
  from: number,
  to: number,
): QueueItem[] {
  if (from < 0 || from >= queue.length) return queue;
  const target = Math.max(0, Math.min(queue.length - 1, to));
  if (target === from) return queue;
  const rest = [...queue.slice(0, from), ...queue.slice(from + 1)];
  return [...rest.slice(0, target), queue[from], ...rest.slice(target)];
}
