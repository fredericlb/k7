// PlaybackProvider.tsx — the médiathèque's transport, and it makes its own sound: one <audio>
// element this tab owns, playing the master this service already serves.
//
// It drove a moteur once, and an mpv on that moteur's machine — the first through the engine
// protocol, the second through that machine's file service, found via the engine registry. Both
// are gone with pl8's knowledge of engines: what plays is the file, here, in the browser.
// See ../../docs/playback.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { library } from "../api";
import type { QueueItem } from "./queue";
import type { PlaybackTarget } from "./targets";
import type { PlayQueue } from "./usePlayQueue";

export interface NowPlaying {
  entry: MediatekEntry;
  /** The loaded version's médiathèque-relative path — the identity, since two songs share a name. */
  path: string;
  /** The version's own name when it is not the master. */
  version?: string;
  /** Where it is playing. One destination today; the field stays, because a second is one entry away. */
  target: PlaybackTarget;
}

export interface Playback {
  now: NowPlaying | null;
  playing: boolean;
  /** Seconds into the song. */
  position: number;
  /** Seconds, or 0 before the master's metadata has arrived. */
  duration: number;
  /** Start something — replacing whatever was playing, since one tab makes one sound. */
  start: (what: NowPlaying, from?: number) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  /** Why nothing is coming out. */
  error: string;
  /** Bumped each time what was loaded reached its end BY ITSELF — a counter, not a flag. */
  ended: number;
  /** Silence it and forget it: the bar's close button, and the only thing that clears `now`. */
  close: () => void;

  /** What plays next, beside the transport because a queue outlives the screen that filled it. */
  queue: QueueItem[];
  enqueue: (entries: MediatekEntry[]) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  takeNext: () => QueueItem | null;
}

const PlaybackContext = createContext<Playback | null>(null);

export function usePlayback(): Playback {
  const p = useContext(PlaybackContext);
  if (!p) throw new Error("usePlayback outside PlaybackProvider");
  return p;
}

export function PlaybackProvider({
  playQueue,
  children,
}: {
  /** The queue, held HIGHER UP: Library renders this provider and carries the tree that fills it. */
  playQueue: PlayQueue;
  children: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // What `start` asked for, applied once the element is ready — refs, since re-rendering shows nothing.
  const pendingSeek = useRef(0);
  const wantPlay = useRef(false);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(0);

  // Follow the playhead smoothly: `timeupdate` fires ~4×/s, which reads as a stutter.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      if (audioRef.current) setAt(audioRef.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const start = useCallback((what: NowPlaying, from = 0) => {
    setError("");
    setDuration(0);
    setAt(from);
    // Read by `onLoadedMetadata`: there is nothing to seek or play until the element has the file.
    pendingSeek.current = from;
    wantPlay.current = true;
    setNow(what);
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    setAt(seconds);
  }, []);

  const close = useCallback(() => {
    audioRef.current?.pause();
    setNow(null);
    setPlaying(false);
    setAt(0);
    setDuration(0);
    setError("");
  }, []);

  return (
    <PlaybackContext.Provider
      value={{
        now,
        playing,
        position: at,
        duration,
        start,
        toggle,
        seek,
        error,
        ended,
        close,
        queue: playQueue.queue,
        enqueue: playQueue.enqueue,
        removeFromQueue: playQueue.removeFromQueue,
        moveInQueue: playQueue.moveInQueue,
        takeNext: playQueue.takeNext,
      }}
    >
      {now ? (
        // biome-ignore lint/a11y/useMediaCaption: a song master has no caption track
        <audio
          ref={audioRef}
          src={library.fileUrl(now.path)}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          // The exact signal: it fires for a song reaching its end and nothing else.
          onEnded={() => {
            setPlaying(false);
            setEnded((n) => n + 1);
          }}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            // Whatever `start` asked for, now that there is something to ask it of.
            if (pendingSeek.current) {
              e.currentTarget.currentTime = pendingSeek.current;
              pendingSeek.current = 0;
            }
            if (wantPlay.current) {
              wantPlay.current = false;
              void e.currentTarget.play().catch(() => {});
            }
          }}
          onTimeUpdate={(e) => {
            if (!playing) setAt(e.currentTarget.currentTime);
          }}
          // A master that will not load is silence too, and the bar is the only thing left to say so.
          onError={() =>
            setError("lecture impossible : le master n'a pas pu être chargé")
          }
        />
      ) : null}
      {children}
    </PlaybackContext.Provider>
  );
}
