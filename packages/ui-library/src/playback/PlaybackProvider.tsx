// PlaybackProvider.tsx — the médiathèque's transport, over two destinations that share one
// interface: the engine the host's selector shows, or, while none answers, an <audio> element this
// tab owns. Only the second plays from THIS origin's bytes, which is why the engine's end is
// inferred rather than read off an element.
// See ../../docs/playback.md and ../../docs/playbackTarget.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { library, libraryAt } from "../api";
import {
  localPathOn,
  songPreviewDoc,
  warnsAbout,
} from "../engine/enginePlayback";
import { type EngineFrame, useSongEngine } from "../engine/useSongEngine";
import { useLibraryHost } from "../host";
import { PositionContext, PositionStore } from "./position";
import type { QueueItem } from "./queue";
import { effectiveTarget, type PlaybackTarget } from "./targets";
import type { PlayQueue } from "./usePlayQueue";

export interface NowPlaying {
  entry: MediatekEntry;
  /** The loaded version's médiathèque-relative path — the identity, since two songs share a name. */
  path: string;
  /** Where its bytes stream from when it is not on this machine (the paired server, on the phone); unset is the pages' library. */
  base?: string;
  /** The version's own name when it is not the master. */
  version?: string;
  /** Where it is playing, set by `start` — the two destinations are driven differently from here down. */
  target: PlaybackTarget;
}

/** What a caller asks to play: where it plays is the provider's to decide. */
export type Playable = Omit<NowPlaying, "target">;

/** What plays and how to drive it; WHERE in it the transport is lives apart, in `usePlaybackPosition` (position.ts). */
export interface Playback {
  now: NowPlaying | null;
  playing: boolean;
  /** Start something — replacing whatever was playing, since one tab makes one sound. */
  start: (what: Playable, from?: number) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  /** Why nothing is coming out, the engine's own complaint about a clip included. */
  error: string;
  /** Bumped each time what was loaded reached its end BY ITSELF — a counter, not a flag. */
  ended: number;
  /** An engine ANSWERED, so a song plays there — ../../docs/playbackTarget.md. */
  engineAvailable: boolean;

  /** What plays next, beside the transport because a queue outlives the screen that filled it. */
  queue: QueueItem[];
  enqueue: (entries: MediatekEntry[]) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  takeNext: () => QueueItem | null;
}

/** What the engine calls what we sent it — the version is IN the name. */
const docNameOf = (n: NowPlaying) =>
  n.version ? `${n.entry.name} · ${n.version}` : n.entry.name;

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
  /** The queue, held HIGHER UP, by the component that renders this provider. */
  playQueue: PlayQueue;
  children: ReactNode;
}) {
  // Read when a failure is SAID, so the callbacks below need not change with the locale.
  const host = useLibraryHost();
  const said = useRef(host.labels.playback);
  said.current = host.labels.playback;
  // …and the host's way of telling a warning, read the same way.
  const tell = useRef(host.onEngineWarning);
  tell.current = host.onEngineWarning;
  // The position and the length, written by every source below and read only by what draws them.
  const [clock] = useState(() => new PositionStore());
  // Whether the engine's document is OURS, read by its frame callback, which outlives a render.
  const oursRef = useRef(false);
  // The engine's own playhead, taken only while OUR document is the one loaded on it.
  const onEngineFrame = useCallback<EngineFrame>(
    (rolling, playhead) => {
      if (oursRef.current && rolling) clock.set({ position: playhead });
    },
    [clock],
  );
  const engine = useSongEngine(onEngineFrame);
  const audioRef = useRef<HTMLAudioElement>(null);
  // A stop we ASKED for looks exactly like a song ending, so it is remembered for one frame.
  const engineWeStopped = useRef(false);
  // What `start` asked for, applied once the element is ready — refs, since re-rendering shows nothing.
  const pendingSeek = useRef(0);
  const wantPlay = useRef(false);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(0);
  // The document the engine holds for US; null means it is not playing our song, whatever else it does.
  const [loadedEnginePath, setLoadedEnginePath] = useState<string | null>(null);
  // The last file SENT, which survives a restart of the same song and spares it a rebuilt edit.
  const lastSent = useRef<string | null>(null);
  // The song the engine branch is currently asking its two questions about — see ../../docs/playback.md.
  const asked = useRef<string | null>(null);

  const viaEngine = now?.target === "engine";
  const ours = viaEngine && !!loadedEnginePath;
  oursRef.current = ours;

  // Follow the playhead smoothly: `timeupdate` fires ~4×/s, which reads as a stutter.
  useEffect(() => {
    if (!localPlaying || viaEngine) return;
    let raf = 0;
    const loop = () => {
      if (audioRef.current)
        clock.set({ position: audioRef.current.currentTime });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [localPlaying, viaEngine, clock]);

  // The engine reaching the end, INFERRED: it reports a transport and not an event.
  const engineWasPlaying = useRef(false);
  useEffect(() => {
    if (!viaEngine) return;
    const rolling = ours && engine.playing;
    if (engineWasPlaying.current && !rolling && !engineWeStopped.current)
      setEnded((n) => n + 1);
    engineWasPlaying.current = rolling;
    engineWeStopped.current = false;
  }, [viaEngine, ours, engine.playing]);

  // Only a complaint naming the file we sent means silence; any other is the host's to tell, never the bar's (../../docs/playback.md).
  useEffect(() => {
    const w = engine.warning;
    if (!viaEngine || !w) return;
    if (lastSent.current && warnsAbout(w.message, lastSent.current))
      setError(said.current.engineCannotOpen);
    else if (tell.current) tell.current(w);
    else console.warn(`engine: ${w.message}`);
  }, [viaEngine, engine.warning]);

  /** Send a song to the engine — the song is brought to its machine HERE, and before any document goes. */
  const startOnEngine = useCallback(
    async (what: NowPlaying, from: number) => {
      const id = engine.engineId;
      if (!id) return setError(said.current.noEngine);
      // Clicking a second song while the question below is in flight must not play the first.
      asked.current = what.path;
      // Asked BEFORE the document goes: an unopenable clip is silence with everything reporting fine.
      const there = await localPathOn(id, what.path);
      if (asked.current !== what.path) return;
      if (!("path" in there))
        return setError(
          there.why === "absent"
            ? said.current.noEngine
            : there.why === "missing"
              ? said.current.notInLibrary
              : said.current.engineSaid(there.error),
        );
      const abs = there.path;
      // A clean edit for a document this session has not held — an apply is a DIFF.
      if (lastSent.current !== abs) engine.reset();
      lastSent.current = abs;
      setLoadedEnginePath(abs);
      engineWeStopped.current = false;
      engine.play(songPreviewDoc(abs, docNameOf(what)), from);
    },
    [engine],
  );

  const start = useCallback(
    (what: Playable, from = 0) => {
      // The fallback is decided HERE, once, so no caller has to know whether an engine answered.
      const loading: NowPlaying = {
        ...what,
        target: effectiveTarget(engine.available, !!what.base),
      };
      setError("");
      // Where the engine was ASKED to be is the only honest answer until its ~20 Hz frame lands.
      clock.set({ position: from, duration: 0 });
      // Read by `onLoadedMetadata`: there is nothing to seek or play until the element has the file.
      pendingSeek.current = from;
      wantPlay.current = loading.target === "browser";
      setNow(loading);

      if (loading.target === "engine") {
        audioRef.current?.pause();
        // Cleared for the length of the two questions below: nothing of ours is loaded yet.
        setLoadedEnginePath(null);
        void startOnEngine(loading, from);
        return;
      }
      // The engine keeps whatever it had; it is simply no longer what we are listening to.
      if (loadedEnginePath) {
        engineWeStopped.current = true;
        engine.stop();
        setLoadedEnginePath(null);
      }
    },
    [engine, loadedEnginePath, startOnEngine, clock],
  );

  const playing = viaEngine ? ours && engine.playing : localPlaying;

  const toggle = useCallback(() => {
    if (viaEngine) {
      if (!now) return;
      if (ours && engine.playing) {
        engineWeStopped.current = true;
        return engine.stop();
      }
      // Past the end a resume rolls over nothing: the engine does not rewind on play.
      const { position, duration } = clock.get();
      const from = duration && position >= duration - 0.25 ? 0 : position;
      clock.set({ position: from });
      if (ours && lastSent.current)
        return engine.play(
          songPreviewDoc(lastSent.current, docNameOf(now)),
          from,
        );
      void startOnEngine(now, from);
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [viaEngine, now, ours, engine, clock, startOnEngine]);

  const seek = useCallback(
    (seconds: number) => {
      // Optimistic on both: waiting for a round trip jumps the cursor back under the mouse.
      const to = Math.max(0, seconds);
      clock.set({ position: to });
      if (viaEngine) {
        if (ours) engine.seek(to);
        return;
      }
      const el = audioRef.current;
      if (el) el.currentTime = to;
    },
    [viaEngine, ours, engine, clock],
  );

  const value = useMemo<Playback>(
    () => ({
      now,
      playing,
      start,
      toggle,
      seek,
      error,
      ended,
      engineAvailable: engine.available,
      queue: playQueue.queue,
      enqueue: playQueue.enqueue,
      removeFromQueue: playQueue.removeFromQueue,
      moveInQueue: playQueue.moveInQueue,
      takeNext: playQueue.takeNext,
    }),
    [
      now,
      playing,
      start,
      toggle,
      seek,
      error,
      ended,
      engine.available,
      playQueue,
    ],
  );

  return (
    <PlaybackContext.Provider value={value}>
      <PositionContext.Provider value={clock}>
        {now ? (
          // Mounted for the engine too, silent: it is what reports the duration of what plays there.
          // biome-ignore lint/a11y/useMediaCaption: a song master has no caption track
          <audio
            ref={audioRef}
            src={(now.base
              ? libraryAt(() => now.base ?? "")
              : library
            ).streamUrl(now.path)}
            preload="metadata"
            onPlay={() => setLocalPlaying(true)}
            onPause={() => setLocalPlaying(false)}
            // The exact signal: it fires for a song reaching its end and nothing else.
            onEnded={() => {
              setLocalPlaying(false);
              setEnded((n) => n + 1);
            }}
            onLoadedMetadata={(e) => {
              clock.set({ duration: e.currentTarget.duration });
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
            // Silent under the engine, whose own frames say where it is.
            onTimeUpdate={(e) => {
              if (!localPlaying && !viaEngine)
                clock.set({ position: e.currentTarget.currentTime });
            }}
            // A master that will not load is silence too, and the bar is the only thing left to say so.
            onError={() => {
              if (!viaEngine) setError(said.current.masterFailed);
            }}
          />
        ) : null}
        {children}
      </PositionContext.Provider>
    </PlaybackContext.Provider>
  );
}
