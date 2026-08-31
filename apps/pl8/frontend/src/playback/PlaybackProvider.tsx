// PlaybackProvider.tsx — the médiathèque's transport, over two destinations that share one
// interface: an <audio> element this tab owns, or mpv on the host that serves the files. The
// second is POLLED, since a process over there cannot push its position into this bar.
// It drove a moteur once; nothing here knows engines exist. See ../../docs/playback.md.

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
import { library, player } from "../api";
import type { QueueItem } from "./queue";
import type { PlaybackTarget } from "./targets";
import type { PlayQueue } from "./usePlayQueue";

export interface NowPlaying {
  entry: MediatekEntry;
  /** The loaded version's médiathèque-relative path — the identity, since two songs share a name. */
  path: string;
  /** The version's own name when it is not the master. */
  version?: string;
  /** Where it is playing — the two destinations are driven differently from here down. */
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
  // A stop we ASKED for looks exactly like a song ending, so it is remembered for one poll.
  const weStopped = useRef(false);
  // What `start` asked for, applied once the element is ready — refs, since re-rendering shows nothing.
  const pendingSeek = useRef(0);
  const wantPlay = useRef(false);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(0);

  const viaHost = now?.target === "library";

  /** The host's transport, polled: enough that a bar does not stutter, little enough to be cheap. */
  useEffect(() => {
    if (!viaHost || !now) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await player.state();
        if (stop) return;
        setAt(s.position);
        setDuration(s.duration);
        setPlaying(s.playing);
        // mpv goes idle at the end of a track, which is the clean signal the browser's onEnded is.
        if (s.idle && !weStopped.current) setEnded((n) => n + 1);
        weStopped.current = false;
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [viaHost, now]);

  // Follow the playhead smoothly: `timeupdate` fires ~4×/s, which reads as a stutter.
  useEffect(() => {
    if (!playing || viaHost) return;
    let raf = 0;
    const loop = () => {
      if (audioRef.current) setAt(audioRef.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, viaHost]);

  const start = useCallback((what: NowPlaying, from = 0) => {
    setError("");
    setDuration(0);
    setAt(from);
    // Read by `onLoadedMetadata`: there is nothing to seek or play until the element has the file.
    pendingSeek.current = from;
    wantPlay.current = true;
    setNow(what);
    if (what.target !== "library") return;
    // The path is médiathèque-relative already, which is exactly what the host will resolve.
    weStopped.current = false;
    void player
      .play(what.path, from)
      .then((s) => setPlaying(s.playing))
      .catch((e: Error) => setError(e.message));
  }, []);

  const toggle = useCallback(() => {
    if (viaHost) {
      const next = !playing;
      setPlaying(next); // optimistic, and the next poll is the truth
      void player.pause(!next).catch((e: Error) => setError(e.message));
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [viaHost, playing]);

  const seek = useCallback(
    (seconds: number) => {
      // Optimistic on both: waiting for a round trip jumps the cursor back under the mouse.
      setAt(seconds);
      if (viaHost) {
        void player.seek(seconds).catch((e: Error) => setError(e.message));
        return;
      }
      const el = audioRef.current;
      if (el) el.currentTime = seconds;
    },
    [viaHost],
  );

  const close = useCallback(() => {
    // Otherwise the host carries on without us: it is a process over there, not part of this page.
    if (viaHost) {
      weStopped.current = true;
      void player.stop();
    }
    audioRef.current?.pause();
    setNow(null);
    setPlaying(false);
    setAt(0);
    setDuration(0);
    setError("");
  }, [viaHost]);

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
      {now && !viaHost ? (
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
