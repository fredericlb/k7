// QueueAdvance.tsx — a component that draws nothing: it exists only to call `useQueueAdvance`
// INSIDE the provider, which MediaPlayback mounts around everything.
// See ../../docs/miniPlayer.md.

import type { PlaybackTarget } from "./targets";
import { useQueueAdvance } from "./useQueueAdvance";

export function QueueAdvance({ target }: { target: PlaybackTarget }) {
  useQueueAdvance(target);
  return null;
}
