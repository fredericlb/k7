// QueueAdvance.tsx — un composant qui ne dessine rien : il n'existe que pour appeler
// `useQueueAdvance` DANS le provider, que la Library monte autour de tout. Voir
// ../../docs/miniPlayer.md.

import type { PlaybackTarget } from "./targets";
import { useQueueAdvance } from "./useQueueAdvance";

export function QueueAdvance({
  machine,
  target,
}: {
  machine: { fileBase: string | null; token: string | null; ready: boolean };
  target: PlaybackTarget;
}) {
  useQueueAdvance(machine, target);
  return null;
}
