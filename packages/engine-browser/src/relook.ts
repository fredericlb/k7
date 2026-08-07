// relook.ts — quand refaire la mesure des moteurs. Une sonde est un INSTANTANÉ, et elle était
// prise une seule fois par onglet : une course malchanceuse marquait le moteur injoignable
// jusqu'au rechargement de la page. Voir docs/access.md.

import { useEffect, useState } from "react";

/**
 * Entre deux mesures.
 *
 * Calé sur `REGISTRY_TTL_MS` (15 s) : plus long ne servirait à rien — un moteur qui a cessé de
 * battre a déjà disparu de la liste, et c'est la liste qui le dira — et plus court sonderait
 * plus vite que l'information ne peut changer.
 */
export const RELOOK_MS = 15_000;

/**
 * Un compteur qui avance quand il vaut la peine de re-mesurer. À mettre dans les dépendances
 * de l'effet qui appelle `find()`.
 *
 * Deux déclencheurs, et le second compte autant que le premier :
 *
 * 1. **L'intervalle**, qui transforme un échec collant en un échec passager. C'est le fond du
 *    problème : `probeEngines` ne rend pas une latence lente pour un moteur lent, il rend
 *    `unreachable`, qui est un état à part — donc une seule mesure ratée ne se corrigeait
 *    jamais d'elle-même.
 * 2. **Le retour de l'onglet au premier plan.** Un onglet caché ne sonde pas : ouvrir des
 *    WebSockets vers chaque adresse candidate pour un écran que personne ne regarde coûte
 *    sans rien apprendre. Mais c'est précisément en y revenant qu'on lit « injoignable », et
 *    c'est là qu'on veut la réponse fraîche — pas quinze secondes plus tard.
 */
export function useRelook(everyMs: number = RELOOK_MS): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const bump = () => {
      if (visible()) setTick((n) => n + 1);
    };
    const timer = setInterval(bump, everyMs);
    document.addEventListener("visibilitychange", bump);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [everyMs]);
  return tick;
}
