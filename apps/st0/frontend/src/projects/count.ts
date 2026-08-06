// count.ts — combien l'onglet Projets annonce. Pur, et à part, parce que c'est un compte qui
// s'est déjà trompé de chose : l'en-tête dit « Projets » et comptait les dépôts.

import type { RepoSummary } from "@studio/web-protocol";

/**
 * Le nombre de PROJETS, tous dépôts confondus.
 *
 * Pas le nombre de dépôts : l'onglet s'appelle « Projets », et un dépôt qui en contient cinq
 * est cinq choses à ouvrir, pas une. C'est aussi ce que la liste dessine — les projets en
 * retrait sous leur dépôt (voir ../../docs/projects.md).
 *
 * `projects: null` compte pour zéro et ne peut pas faire autrement : ça veut dire « miroir
 * jamais lu », donc un nombre qu'on n'a pas. Le badge le montre donc bas puis juste, quelques
 * secondes plus tard — ce qui est l'honnête façon de ne pas savoir, là où inventer un chiffre
 * ou masquer le badge seraient toutes deux des affirmations.
 */
export function projectCount(repos: RepoSummary[]): number {
  return repos.reduce((n, r) => n + (r.projects?.length ?? 0), 0);
}
