// ProjectBar.tsx — the project's transport, drawn as the app's mini player: its buttons where the
// bar keeps play/pause, and the clock and a peekable minimap where it keeps the scrubber. The
// sound is the engine's, never this page's, so the bar leaves the system's media session alone.
// See docs/shell.md, "The project bar".

import { AudioLines } from "@frediverse/ui/icons";
import { MiniPlayer } from "@studio/ui-mini-player";
import type { ComponentProps } from "react";
import { Minimap } from "../components/Minimap";
import type { RecInfo } from "../hooks/useProjectDoc";
import { m } from "../paraglide/messages.js";
import { TransportClock } from "../shellMeta";
import { ShellTransport } from "./ShellTransport";

export function ProjectBar({
  title,
  transport,
  map,
  recInfo,
}: {
  title: string;
  /** The buttons, or null where they would drive nothing on screen (the desk alone). */
  transport: ComponentProps<typeof ShellTransport> | null;
  /** The minimap, or null for a project with no arrangement to map. */
  map: ComponentProps<typeof Minimap> | null;
  recInfo: RecInfo;
}) {
  const playing = !!transport?.playing;
  return (
    <MiniPlayer
      icon={AudioLines}
      title={title}
      playing={playing}
      // The clock and the map read the playhead themselves, so the bar never re-renders with it.
      position={0}
      duration={0}
      mediaSession={false}
      labels={{
        region: m["transport.region"](),
        play: m["transport.play"](),
        pause: m["transport.pause"](),
        position: m["minimap.movePlayhead"](),
        close: m["common.close"](),
      }}
      onToggle={() => transport?.transport(playing ? "stop" : "play")}
      onSeek={(s) => map?.onSeek(s)}
      transport={transport ? <ShellTransport {...transport} /> : null}
      track={
        map ? (
          <>
            <TransportClock
              tempo={recInfo.tempo}
              beatsPerBar={recInfo.beatsPerBar}
            />
            <Minimap {...map} />
          </>
        ) : null
      }
    />
  );
}
