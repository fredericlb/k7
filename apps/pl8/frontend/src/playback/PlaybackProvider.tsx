// PlaybackProvider.tsx — the médiathèque's transport, over three destinations that share one
// interface: an <audio> element this tab owns, mpv on the host that serves the files, or the
// engine on the musician's own machine. Only the first plays from THIS origin's bytes, which is
// why the other two are polled or inferred rather than read off an element.
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
import { library, player } from "../api";
import { localPathOn, songPreviewDoc } from "../engine/enginePlayback";
import { useSongEngine } from "../engine/useSongEngine";
import type { QueueItem } from "./queue";
import { effectiveTarget, type PlaybackTarget } from "./targets";
import type { PlayQueue } from "./usePlayQueue";

// The ways the engine has nothing to open, kept apart because they are repaired differently.
const ENGINE_ABSENT = "aucun moteur ne répond — lecture ici";
const ENGINE_NOT_HERE =
  "ce morceau n'est pas dans la médiathèque — rien ne sortirait de ses enceintes";

export interface NowPlaying {
  entry: MediatekEntry;
  /** The loaded version's médiathèque-relative path — the identity, since two songs share a name. */
  path: string;
  /** The version's own name when it is not the master. */
  version?: string;
  /** Where it is playing — the three destinations are driven differently from here down. */
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
  /** Why nothing is coming out, the engine's own complaint about a clip included. */
  error: string;
  /** Bumped each time what was loaded reached its end BY ITSELF — a counter, not a flag. */
  ended: number;
  /** Silence it and forget it: the bar's close button, and the only thing that clears `now`. */
  close: () => void;
  /** An engine ANSWERED: what makes the moteur an offerable destination — ../../docs/playbackTarget.md. */
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
  target,
  playQueue,
  children,
}: {
  /** The account's chosen destination: it is what decides whether a socket is worth holding. */
  target: PlaybackTarget;
  /** The queue, held HIGHER UP: Library renders this provider and carries the tree that fills it. */
  playQueue: PlayQueue;
  children: ReactNode;
}) {
  // Connected only while the moteur is the destination: looking costs nothing, holding one does.
  const engine = useSongEngine(target === "engine");
  const audioRef = useRef<HTMLAudioElement>(null);
  // A stop we ASKED for looks exactly like a song ending, so it is remembered for one poll.
  const weStopped = useRef(false);
  const engineWeStopped = useRef(false);
  // What `start` asked for, applied once the element is ready — refs, since re-rendering shows nothing.
  const pendingSeek = useRef(0);
  const wantPlay = useRef(false);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(0);
  // The document the engine holds for US; null means it is not playing our song, whatever else it does.
  const [loadedEnginePath, setLoadedEnginePath] = useState<string | null>(null);
  // The last file SENT, which survives a restart of the same song and spares it a rebuilt edit.
  const lastSent = useRef<string | null>(null);
  // The song the engine branch is currently asking its two questions about — see ../../docs/playback.md.
  const asked = useRef<string | null>(null);
  // Where the engine was ASKED to be, the only honest answer until its ~20 Hz frame lands.
  const [engineAt, setEngineAt] = useState(0);

  const viaHost = now?.target === "library";
  const viaEngine = now?.target === "engine";
  const ours = viaEngine && !!loadedEnginePath;

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
        setLocalPlaying(s.playing);
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
    if (!localPlaying || viaHost || viaEngine) return;
    let raf = 0;
    const loop = () => {
      if (audioRef.current) setAt(audioRef.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [localPlaying, viaHost, viaEngine]);

  // The engine's own playhead, read only while OUR document is the one loaded on it.
  useEffect(() => {
    if (ours && engine.playing) setEngineAt(engine.playhead);
  }, [ours, engine.playing, engine.playhead]);

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

  // A clip it could not open plays SILENCE, so this channel is the only account of it.
  useEffect(() => {
    if (viaEngine && engine.warning)
      setError(`le moteur : ${engine.warning.message}`);
  }, [viaEngine, engine.warning]);

  /** Send a song to the engine — the song is brought to its machine HERE, and before any document goes. */
  const startOnEngine = useCallback(
    async (what: NowPlaying, from: number) => {
      const id = engine.engineId;
      if (!id) return setError(ENGINE_ABSENT);
      // Clicking a second song while the question below is in flight must not play the first.
      asked.current = what.path;
      // Asked BEFORE the document goes: an unopenable clip is silence with everything reporting fine.
      const there = await localPathOn(id, what.path);
      if (asked.current !== what.path) return;
      if (!("path" in there))
        return setError(
          there.why === "absent"
            ? ENGINE_ABSENT
            : there.why === "missing"
              ? ENGINE_NOT_HERE
              : `le moteur : ${there.error}`,
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
    (what: NowPlaying, from = 0) => {
      // The fallback is decided HERE, once, so no caller has to know whether an engine answered.
      const loading = {
        ...what,
        target: effectiveTarget(what.target, engine.available),
      };
      setError("");
      setDuration(0);
      setAt(from);
      setEngineAt(from);
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
      if (loading.target !== "library") return;
      // The path is médiathèque-relative already, which is exactly what the host will resolve.
      weStopped.current = false;
      void player
        .play(loading.path, from)
        .then((s) => setLocalPlaying(s.playing))
        .catch((e: Error) => setError(e.message));
    },
    [engine, loadedEnginePath, startOnEngine],
  );

  const playing = viaEngine ? ours && engine.playing : localPlaying;
  const position = viaEngine ? engineAt : at;

  const toggle = useCallback(() => {
    if (viaEngine) {
      if (!now) return;
      if (ours && engine.playing) {
        engineWeStopped.current = true;
        return engine.stop();
      }
      // Past the end a resume rolls over nothing: the engine does not rewind on play.
      const from = duration && engineAt >= duration - 0.25 ? 0 : engineAt;
      setEngineAt(from);
      if (ours && lastSent.current)
        return engine.play(
          songPreviewDoc(lastSent.current, docNameOf(now)),
          from,
        );
      void startOnEngine(now, from);
      return;
    }
    if (viaHost) {
      const next = !localPlaying;
      setLocalPlaying(next); // optimistic, and the next poll is the truth
      void player.pause(!next).catch((e: Error) => setError(e.message));
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [
    viaEngine,
    viaHost,
    now,
    ours,
    engine,
    duration,
    engineAt,
    localPlaying,
    startOnEngine,
  ]);

  const seek = useCallback(
    (seconds: number) => {
      // Optimistic on all three: waiting for a round trip jumps the cursor back under the mouse.
      const to = Math.max(0, seconds);
      if (viaEngine) {
        setEngineAt(to);
        if (ours) engine.seek(to);
        return;
      }
      setAt(to);
      if (viaHost) {
        void player.seek(to).catch((e: Error) => setError(e.message));
        return;
      }
      const el = audioRef.current;
      if (el) el.currentTime = to;
    },
    [viaEngine, viaHost, ours, engine],
  );

  const close = useCallback(() => {
    // Otherwise the other side carries on without us: it is a process over there, not part of this page.
    if (viaHost) {
      weStopped.current = true;
      void player.stop();
    }
    if (ours) {
      engineWeStopped.current = true;
      engine.stop();
    }
    audioRef.current?.pause();
    setNow(null);
    setLoadedEnginePath(null);
    setLocalPlaying(false);
    setAt(0);
    setEngineAt(0);
    setDuration(0);
    setError("");
  }, [viaHost, ours, engine]);

  const value = useMemo<Playback>(
    () => ({
      now,
      playing,
      position,
      duration,
      start,
      toggle,
      seek,
      error,
      ended,
      close,
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
      position,
      duration,
      start,
      toggle,
      seek,
      error,
      ended,
      close,
      engine.available,
      playQueue,
    ],
  );

  return (
    <PlaybackContext.Provider value={value}>
      {now && !viaHost ? (
        // Mounted for the engine too, silent: it is what reports the duration of what plays there.
        // biome-ignore lint/a11y/useMediaCaption: a song master has no caption track
        <audio
          ref={audioRef}
          src={library.fileUrl(now.path)}
          preload="metadata"
          onPlay={() => setLocalPlaying(true)}
          onPause={() => setLocalPlaying(false)}
          // The exact signal: it fires for a song reaching its end and nothing else.
          onEnded={() => {
            setLocalPlaying(false);
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
            if (!localPlaying) setAt(e.currentTarget.currentTime);
          }}
          // A master that will not load is silence too, and the bar is the only thing left to say so.
          onError={() => {
            if (!viaEngine)
              setError("lecture impossible : le master n'a pas pu être chargé");
          }}
        />
      ) : null}
      {children}
    </PlaybackContext.Provider>
  );
}
