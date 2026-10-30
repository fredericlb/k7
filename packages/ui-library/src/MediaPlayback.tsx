// MediaPlayback.tsx — what plays, for everything inside it: the queue, the transport and the bar
// at the bottom. Mounted by the host AROUND its chrome, so a queue button in a sidebar and the
// catalogue's play buttons drive one transport. It probes and holds an engine, so a host mounts
// it only on the pages that can play. See ../docs/miniPlayer.md.

import type { ReactNode } from "react";
import { MiniPlayer } from "./playback/MiniPlayer";
import { PlaybackProvider } from "./playback/PlaybackProvider";
import { QueueAdvance } from "./playback/QueueAdvance";
import { usePlayQueue } from "./playback/usePlayQueue";

export function MediaPlayback({ children }: { children: ReactNode }) {
  // Held HERE because this component RENDERS the provider — see playback/usePlayQueue.ts.
  const playQueue = usePlayQueue();
  return (
    <PlaybackProvider playQueue={playQueue}>
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">{children}</div>
        {/* Draws nothing: it is the queue's advance. */}
        <QueueAdvance />
        <MiniPlayer />
      </div>
    </PlaybackProvider>
  );
}
