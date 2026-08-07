// usePlayQueue.ts — la file d'attente, tenue par la Library et passée au transport.
//
// Là et non dans le provider parce que la Library le REND : elle est au-dessus du contexte, et
// c'est elle qui porte l'arbre dont le clic droit remplit la file. Une par onglet, au-dessus
// des écrans, comme le transport lui-même. Voir ../../docs/miniPlayer.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import { useCallback, useRef, useState } from "react";
import {
  enqueue as enqueueInto,
  moveTo,
  type QueueItem,
  removeAt,
} from "./queue";

export interface PlayQueue {
  queue: QueueItem[];
  enqueue: (entries: MediatekEntry[]) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  /** Prendre la tête et la retirer, ou `null`. */
  takeNext: () => QueueItem | null;
}

export function usePlayQueue(): PlayQueue {
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const enqueue = useCallback((list: MediatekEntry[]) => {
    setQueue((q) => enqueueInto(q, list));
  }, []);
  const removeFromQueue = useCallback((i: number) => {
    setQueue((q) => removeAt(q, i));
  }, []);
  const moveInQueue = useCallback((from: number, to: number) => {
    setQueue((q) => moveTo(q, from, to));
  }, []);

  /**
   * Par une ref, parce que l'appelant est un effet qui réagit à la fin d'un morceau : il doit
   * lire la file TELLE QU'ELLE EST à cet instant, et une valeur capturée au rendu précédent
   * lui ferait reprendre un morceau déjà pris.
   */
  const held = useRef(queue);
  held.current = queue;
  const takeNext = useCallback((): QueueItem | null => {
    const head = held.current[0];
    if (!head) return null;
    // Comparé par identité avant de couper : deux appels rapprochés ne doivent pas retirer
    // deux morceaux pour un seul qui démarre.
    setQueue((q) => (q[0]?.id === head.id ? q.slice(1) : q));
    return head;
  }, []);

  return { queue, enqueue, removeFromQueue, moveInQueue, takeNext };
}
