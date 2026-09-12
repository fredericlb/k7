// ReferenceBar.tsx — the reference track's transport, at the bottom of the shell. The <audio>
// element is HERE, so the sound is the BROWSER's and owes nothing to the engine: a reference
// plays over a live rig or a running arrangement without asking either of them.
// See ../docs/references.md.

import type { ReferenceTrack } from "@studio/song-schema/reference";
import { MiniPlayer } from "@studio/ui-mini-player";
import { Headphones } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../api";
import { m } from "../paraglide/messages.js";

/** The folder a track sits in, shown beside its name — two bounces are often called the same thing. */
function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  const dir = at < 0 ? "" : path.slice(0, at);
  const cut = dir.indexOf("/");
  return cut < 0 ? "" : dir.slice(cut + 1);
}

export function ReferenceBar({
  track,
  onClose,
}: {
  track: ReferenceTrack;
  onClose: () => void;
}) {
  const el = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  // A track chosen in the panel starts by itself: that click is the gesture autoplay wants.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `track.path` is the TRIGGER — the new src is on the element by the time this runs.
  useEffect(() => {
    setError("");
    setAt(0);
    setDuration(0);
    el.current?.play().catch(() => setPlaying(false));
  }, [track.path]);

  const done = duration > 0 && at >= duration - 0.25 && !playing;
  const folder = folderOf(track.path);

  const toggle = (): void => {
    const a = el.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    // Past the end, play() rewinds by itself — but only once the length is known.
    a.play().catch((e: Error) => setError(e.message));
  };

  return (
    <>
      {/* Never `controls`: the bar IS the control, and a second set of buttons would drift from it. */}
      <audio
        ref={el}
        src={mediaUrl(track.path)}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError(m["refs.cannotPlay"]())}
      >
        <track kind="captions" />
      </audio>
      <MiniPlayer
        icon={Headphones}
        title={track.name}
        playing={playing}
        position={at}
        duration={duration}
        labels={{
          region: m["refs.region"](),
          play: m["refs.play"](),
          pause: m["refs.pause"](),
          position: m["refs.position"](),
          close: m["refs.closePlayer"](),
        }}
        onToggle={toggle}
        onSeek={(s) => {
          if (el.current) el.current.currentTime = s;
          setAt(s);
        }}
        onClose={onClose}
        meta={
          folder ? (
            <span className="hidden min-w-0 truncate text-muted-foreground text-xs sm:inline">
              {folder}
            </span>
          ) : null
        }
        status={
          error ? (
            <span className="min-w-0 truncate text-destructive text-xs">
              {error}
            </span>
          ) : done ? (
            <span className="shrink-0 text-muted-foreground text-xs">
              {m["refs.ended"]()}
            </span>
          ) : null
        }
      >
        {/* Said on the bar, because it is the one thing about this sound that surprises people. */}
        <span className="hidden shrink-0 text-muted-foreground text-xs sm:inline">
          {m["refs.throughBrowser"]()}
        </span>
      </MiniPlayer>
    </>
  );
}
