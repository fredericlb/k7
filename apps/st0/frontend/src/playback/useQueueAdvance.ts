// useQueueAdvance.ts — un morceau se termine, le suivant part. Monté là où vivent la machine
// choisie et la destination, parce que c'est ce qu'il faut pour savoir OÙ un fichier se joue.
// Voir ../../docs/miniPlayer.md.

import { takesOf } from "@studio/mediatek/takes";
import { useCallback, useEffect, useRef } from "react";
import { currentUser } from "../api";
import { cacheRoot, playablePath } from "../engine/songPreview";
import { usePlayback } from "./PlaybackProvider";
import { effectiveTarget, type PlaybackTarget } from "./targets";

/** Le master d'un morceau : c'est ce qu'« ajouter à la liste de lecture » veut dire. Les
 *  variantes se choisissent sur la page du morceau, une à la fois, ce que la file n'est pas. */
const masterOf = (entry: Parameters<typeof takesOf>[0]): string | null =>
  takesOf(entry).find((t) => t.kind === "master")?.file ?? null;

/**
 * Enchaîner sur la file quand ce qui jouait se termine.
 *
 * `ended` est un compteur, donc comparé à ce qu'on a vu plutôt que réagi comme à un drapeau
 * que quelqu'un devrait remettre à zéro.
 *
 * Le morceau qui ne se résout pas est SAUTÉ et non bloquant : une file qui s'arrêterait à son
 * troisième titre parce qu'une machine n'en a pas le cache serait une file qu'on ne peut pas
 * écouter pendant qu'on la répare. Sauf si c'est la DESTINATION qui manque — sans cache du
 * tout, tout échouerait, et parcourir la file entière pour ça ressemblerait à une file cassée.
 */
export function useQueueAdvance(
  machine: { fileBase: string | null; token: string | null; ready: boolean },
  target: PlaybackTarget,
): void {
  const playback = usePlayback();
  const actual = effectiveTarget(target, machine.ready);
  const viaEngine = actual === "engine";

  // Le cache de cette machine, demandé une fois par machine. `undefined` = pas encore su, ce
  // qui n'est ni « il y en a un » ni « il n'y en a pas » — d'où trois états et non deux.
  const root = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    root.current = undefined;
    if (!viaEngine || !machine.fileBase || !machine.token) return;
    let stop = false;
    void cacheRoot(machine.fileBase, currentUser(), machine.token)
      .then((r) => {
        if (!stop) root.current = r;
      })
      .catch(() => {
        if (!stop) root.current = null;
      });
    return () => {
      stop = true;
    };
  }, [viaEngine, machine.fileBase, machine.token]);

  const startNext = useCallback(() => {
    // Tant qu'il en reste : on saute ce qui ne se résout pas, plutôt que de s'arrêter dessus.
    for (;;) {
      const next = playback.takeNext();
      if (!next) return;
      const file = masterOf(next.entry);
      if (!file) continue;
      const enginePath =
        viaEngine && root.current
          ? playablePath(root.current, next.entry, file)
          : null;
      // La machine n'a pas de cache : c'est un défaut de la destination et non de la ligne, et
      // vider la file pour ça effacerait ce que quelqu'un vient d'y mettre.
      if (viaEngine && !enginePath) return;
      playback.start({
        entry: next.entry,
        path: `${next.entry.path}/${file}`,
        target: actual,
        enginePath,
      });
      return;
    }
  }, [playback.takeNext, playback.start, viaEngine, actual]);

  const seen = useRef(playback.ended);
  useEffect(() => {
    if (playback.ended === seen.current) return;
    seen.current = playback.ended;
    startNext();
  }, [playback.ended, startNext]);

  /**
   * Le démarrage à froid : ajouter à la file alors que rien ne joue lance tout de suite.
   *
   * Sans ça, la file n'aurait aucun moyen de partir — l'avance ci-dessus n'écoute que la FIN
   * d'un morceau, donc un premier ajout resterait là indéfiniment, ce qu'un lecteur ne fait
   * pas. `now` n'est pas vidé quand un morceau se termine (« ce que je viens d'écouter »
   * survit au dernier échantillon), donc ceci ne se déclenche qu'avant la première lecture ou
   * après avoir fermé la barre — jamais entre deux titres.
   */
  useEffect(() => {
    if (playback.now || !playback.queue.length) return;
    startNext();
  }, [playback.now, playback.queue.length, startNext]);
}
