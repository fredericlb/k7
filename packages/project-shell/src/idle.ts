// idle.ts — quand une session est INACTIVE : un horodatage que les gestes de la personne
// remettent à zéro, relu à intervalle grossier. Une date plutôt qu'un `setTimeout` relancé, parce
// qu'une machine qui s'est endormie doit rendre la vérité au réveil. Voir docs/idle.md.

import { useEffect, useRef } from "react";

/** Vingt minutes. Le seul chiffre de cette page, et il est ici pour n'être écrit qu'une fois. */
export const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Tous les quarts de minute, et pas plus fin.
 *
 * On mesure une absence de vingt minutes : une précision à la seconde ne dirait rien de plus, et
 * un onglet en arrière-plan voit de toute façon ses minuteurs bridés à une minute par les
 * navigateurs. Le retard maximal est donc d'environ une minute, ce qui est du bruit à cette
 * échelle.
 */
const CHECK_MS = 15_000;

/**
 * Les gestes qui comptent, sur `window` et en capture.
 *
 * `pointermove` est là exprès : promener la souris sur une forme d'onde en écoutant est de
 * l'activité, et l'exclure déconnecterait quelqu'un qui regarde son morceau. Chacun ne fait
 * qu'une affectation, donc la fréquence de `pointermove` ne coûte rien — c'est précisément
 * pourquoi l'horodatage bat un minuteur qu'il faudrait annuler et reposer à chaque événement.
 */
const EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/**
 * La dernière activité, au niveau du MODULE et non du hook.
 *
 * Un onglet est une session ; il n'y a donc qu'une horloge, et `markActive()` permet à ce qui
 * n'est pas un geste de la déclarer — un morceau qui joue est une session active, même si
 * personne ne touche rien pendant tout un set. C'est le seul point d'entrée pour ça, et il est
 * volontairement bête : aucun état React à faire remonter depuis le fond de l'application.
 */
let lastActive = Date.now();

/** « Il se passe quelque chose » — pour ce qu'aucun événement d'entrée ne signale. */
export function markActive(): void {
  lastActive = Date.now();
}

/** Depuis combien de temps rien ne s'est passé. Exporté pour les tests et la barre d'état. */
export const idleForMs = (): number => Date.now() - lastActive;

/**
 * Appelle `onIdle` une fois passé `timeoutMs` sans rien.
 *
 * Une seule fois : le hook se démonte avec l'écran qu'il gardait, donc il n'y a pas de second
 * déclenchement à empêcher — mais un `setInterval` qui continue de tourner sur un état déjà
 * inactif en produirait un par tick, alors le garde reste.
 *
 * `timeoutMs <= 0` désactive tout, y compris les écouteurs : c'est ce que passe une application
 * qui ne veut pas de cette règle, et elle ne doit alors rien payer.
 */
export function useIdleTimeout(timeoutMs: number, onIdle: () => void): void {
  // Par référence : `onIdle` est une closure recréée à chaque rendu, et la mettre en dépendance
  // réabonnerait cinq écouteurs et remettrait l'horloge à zéro à chaque frame de vumètre.
  const fire = useRef(onIdle);
  fire.current = onIdle;

  useEffect(() => {
    if (timeoutMs <= 0) return;
    markActive(); // le montage EST le début de la session
    let done = false;
    const stamp = () => markActive();
    for (const e of EVENTS)
      window.addEventListener(e, stamp, { capture: true, passive: true });
    const t = setInterval(() => {
      if (done || idleForMs() < timeoutMs) return;
      done = true;
      fire.current();
    }, CHECK_MS);
    return () => {
      clearInterval(t);
      for (const e of EVENTS)
        window.removeEventListener(e, stamp, { capture: true });
    };
  }, [timeoutMs]);
}
