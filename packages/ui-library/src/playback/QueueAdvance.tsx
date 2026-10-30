// QueueAdvance.tsx — a component that draws nothing: it exists only to call `useQueueAdvance`
// INSIDE the provider, which MediaPlayback mounts around everything.
// See ../../docs/miniPlayer.md.

import { useQueueAdvance } from "./useQueueAdvance";

export function QueueAdvance() {
  useQueueAdvance();
  return null;
}
