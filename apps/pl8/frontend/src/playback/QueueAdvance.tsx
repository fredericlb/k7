// QueueAdvance.tsx — a component that draws nothing: it exists only to call `useQueueAdvance`
// INSIDE the provider, which the Library mounts around everything.
// See ../../docs/miniPlayer.md.

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
