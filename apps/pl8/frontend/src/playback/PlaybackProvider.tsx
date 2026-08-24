// PlaybackProvider.tsx — what is playing, held ABOVE the screens so it outlives them, and the
// one engine socket this tab owns. A song started from its editor keeps playing while you
// browse; the bar at the bottom is the view of it. See ../../docs/miniPlayer.md.

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
import { engineMachine, library, type MachinePlayerState } from "../api";
import { songPreviewDoc } from "../engine/songPreview";
import { type ModuleEngine, useModuleEngine } from "../engine/useModuleEngine";
import type { QueueItem } from "./queue";
import type { PlaybackTarget } from "./targets";
import type { PlayQueue } from "./usePlayQueue";

/** Twice a second: smooth enough for a progress bar, slow enough not to hammer the machine. */
const MACHINE_POLL_MS = 500;

/** What is loaded, wherever it plays. */
export interface NowPlaying {
  entry: MediatekEntry;
  /** The loaded version's médiathèque-relative path — the identity, since two songs share a name (../../docs/playback.md). */
  path: string;
  /** The version's own name when it is not the master, which the engine's document is named after (../../docs/playback.md). */
  version?: string;
  /** Where it is ACTUALLY playing — the caller resolves the fallback, since it knows whether an engine answered. */
  target: PlaybackTarget;
  /** The same master as a path on the engine's machine, resolved by the caller. Null in the browser. */
  enginePath: string | null;
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
  /** Why nothing is coming out in the BROWSER; the engine's own complaints are on `useEngine().warning`. */
  error: string;
  /** Bumped each time what was loaded reached its end BY ITSELF — a counter, not a flag (../../docs/playback.md). */
  ended: number;
  /** Silence it and forget it: the bar's close button, and the only thing that clears `now`. */
  close: () => void;

  /** What plays next, beside the transport because a queue outlives the screen that filled it (packages/song/docs/playlists.md). */
  queue: QueueItem[];
  /** Append, without duplicates. */
  enqueue: (entries: MediatekEntry[]) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  /** Take the head of the queue and drop it, or `null`. What auto-advance does. */
  takeNext: () => QueueItem | null;
}

/** What the engine calls what we sent it — the version is IN the name (../../docs/playback.md). */
const docNameOf = (n: NowPlaying) =>
  n.version ? `${n.entry.name} · ${n.version}` : n.entry.name;

const EngineContext = createContext<ModuleEngine | null>(null);
const PlaybackContext = createContext<Playback | null>(null);

/** The engine this tab drives, and there is exactly ONE — see ../../docs/playback.md. */
export function useEngine(): ModuleEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine outside PlaybackProvider");
  return engine;
}

export function usePlayback(): Playback {
  const playback = useContext(PlaybackContext);
  if (!playback) throw new Error("usePlayback outside PlaybackProvider");
  return playback;
}

export function PlaybackProvider({
  engineId,
  playQueue,
  machine,
  children,
}: {
  /** The account's chosen engine, from the header's picker. */
  engineId?: string;
  /** The queue, held HIGHER UP: Library renders this provider and carries the tree that fills it. */
  playQueue: PlayQueue;
  /** The chosen machine's file service, for the "machine" destination — it is what drives that mpv. */
  machine: { fileBase: string | null; token: string | null };
  children: ReactNode;
}) {
  const engine = useModuleEngine(engineId);
  const audioRef = useRef<HTMLAudioElement>(null);
  // What `start` asked for, applied once the element is ready — refs, since re-rendering shows nothing.
  const pendingSeek = useRef(0);
  const wantPlay = useRef(false);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [browserPlaying, setBrowserPlaying] = useState(false);
  const [browserAt, setBrowserAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(0);
  // That the transport is about to stop because WE asked it to — see ../../docs/playback.md.
  const weStopped = useRef(false);
  const wasPlaying = useRef(false);
  // The document the engine holds for US; null means it is not playing our song, whatever else it does.
  const [loadedEnginePath, setLoadedEnginePath] = useState<string | null>(null);
  // Where the engine was ASKED to be, which is the only honest answer until its ~20 Hz frame lands.
  const [engineAt, setEngineAt] = useState(0);

  const viaEngine = now?.target === "engine";
  const ours =
    viaEngine && !!now?.enginePath && loadedEnginePath === now.enginePath;

  useEffect(() => {
    if (ours && engine.playing) setEngineAt(engine.playhead);
  }, [ours, engine.playing, engine.playhead]);

  // Follow the browser's playhead smoothly: `timeupdate` fires ~4×/s, which reads as a stutter.
  useEffect(() => {
    if (viaEngine || !browserPlaying) return;
    let raf = 0;
    const loop = () => {
      if (audioRef.current) setBrowserAt(audioRef.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [viaEngine, browserPlaying]);

  /** mpv is elsewhere and cannot push its position here, so it is POLLED (../../docs/playback.md). */
  const viaMachine = now?.target === "machine";
  const [machineState, setMachineState] = useState<MachinePlayerState | null>(
    null,
  );
  useEffect(() => {
    if (!viaMachine || !machine.fileBase || !machine.token) {
      setMachineState(null);
      return;
    }
    let stop = false;
    const tick = () =>
      void engineMachine.player
        .state(machine.fileBase as string, machine.token as string)
        .then((s) => {
          if (!stop) setMachineState(s);
        })
        // Silent: a machine that misses one tick is busy, not an error to show a listener.
        .catch(() => {});
    tick();
    const t = setInterval(tick, MACHINE_POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [viaMachine, machine.fileBase, machine.token]);

  const playing = viaMachine
    ? !!machineState?.playing
    : viaEngine
      ? ours && engine.playing
      : browserPlaying;
  const position = viaMachine
    ? (machineState?.position ?? 0)
    : viaEngine
      ? engineAt
      : browserAt;

  /** The machine reaching the end: mpv goes `idle`, but a requested stop looks the same (../../docs/playback.md). */
  const machineWasPlaying = useRef(false);
  useEffect(() => {
    if (!viaMachine) return;
    const nowPlaying = !!machineState?.playing;
    if (machineWasPlaying.current && !nowPlaying && !weStopped.current)
      setEnded((n) => n + 1);
    machineWasPlaying.current = nowPlaying;
    weStopped.current = false;
  }, [viaMachine, machineState?.playing]);

  // The engine reaching the end, INFERRED: it reports a transport and not an event (../../docs/playback.md).
  useEffect(() => {
    if (!viaEngine) return;
    const playingNow = ours && engine.playing;
    if (wasPlaying.current && !playingNow && !weStopped.current)
      setEnded((n) => n + 1);
    wasPlaying.current = playingNow;
    weStopped.current = false;
  }, [viaEngine, ours, engine.playing]);

  const start = useCallback<Playback["start"]>(
    (what, from = 0) => {
      setNow(what);
      setDuration(0);
      setError("");
      // Whatever the transport does next, it does because of this call — not the end of a song.
      weStopped.current = true;
      if (what.target === "machine") {
        audioRef.current?.pause();
        if (ours) engine.stop();
        setLoadedEnginePath(null);
        // `what.path` is ALREADY médiathèque-relative and the machine resolves it against its own root.
        if (machine.fileBase && machine.token)
          void engineMachine.player
            .play(machine.fileBase, machine.token, what.path, from)
            .then(setMachineState)
            .catch((e: Error) => setError(e.message));
        return;
      }
      if (what.target === "engine") {
        if (!what.enginePath) return;
        audioRef.current?.pause();
        // A clean edit for a document this session has not held — see ../../docs/playback.md.
        if (loadedEnginePath !== what.enginePath) engine.reset();
        setLoadedEnginePath(what.enginePath);
        setEngineAt(from);
        engine.play(songPreviewDoc(what.enginePath, docNameOf(what)), from);
        return;
      }
      // The engine keeps whatever it had; it is simply no longer what we are listening to.
      if (ours) engine.stop();
      setLoadedEnginePath(null);
      setBrowserAt(from);
      const el = audioRef.current;
      if (el && now?.path === what.path) {
        // The same master: `src` will not change, so no metadata event is coming to wait for.
        el.currentTime = from;
        void el.play().catch(() => {});
        return;
      }
      // A different master: the element has not seen the new `src` yet, so both wait for its metadata.
      pendingSeek.current = from;
      wantPlay.current = true;
    },
    [
      engine,
      ours,
      loadedEnginePath,
      now?.path,
      machine.fileBase,
      machine.token,
    ],
  );

  const toggle = useCallback(() => {
    if (!now) return;
    weStopped.current = true; // asked for, either way — see the ref
    if (viaMachine) {
      if (!machine.fileBase || !machine.token) return;
      // Past the end mpv is idle: ask for the file again rather than "resume" nothing.
      if (machineState?.idle)
        void engineMachine.player
          .play(machine.fileBase, machine.token, now.path, 0)
          .then(setMachineState)
          .catch((e: Error) => setError(e.message));
      else
        void engineMachine.player
          .pause(machine.fileBase, machine.token, playing)
          .then(setMachineState)
          .catch(() => {});
      return;
    }
    if (viaEngine) {
      if (ours && engine.playing) return engine.stop();
      if (!now.enginePath) return;
      // Past the end, a resume would roll over nothing: the engine does not rewind on play.
      const from = duration && engineAt >= duration - 0.25 ? 0 : engineAt;
      if (loadedEnginePath !== now.enginePath) engine.reset();
      setLoadedEnginePath(now.enginePath);
      setEngineAt(from);
      engine.play(songPreviewDoc(now.enginePath, docNameOf(now)), from);
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    // `play()` on an element sitting at the end rewinds by itself, which is what the bar needs.
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [
    now,
    viaEngine,
    ours,
    engine,
    duration,
    engineAt,
    loadedEnginePath,
    viaMachine,
    machine.fileBase,
    machine.token,
    machineState?.idle,
    playing,
  ]);

  const seek = useCallback(
    (seconds: number) => {
      const at = Math.max(0, seconds);
      if (viaMachine) {
        // Optimistic: the handle follows the finger and the next poll tells the truth.
        setMachineState((s) => (s ? { ...s, position: at } : s));
        if (machine.fileBase && machine.token)
          void engineMachine.player
            .seek(machine.fileBase, machine.token, at)
            .then(setMachineState)
            .catch(() => {});
        return;
      }
      if (viaEngine) {
        setEngineAt(at);
        if (ours) engine.seek(at);
        return;
      }
      const el = audioRef.current;
      if (el) el.currentTime = at;
      setBrowserAt(at);
    },
    [viaEngine, ours, engine, viaMachine, machine.fileBase, machine.token],
  );

  const close = useCallback(() => {
    weStopped.current = true;
    audioRef.current?.pause();
    if (ours) engine.stop();
    // The machine would carry on without us — closing the bar must silence what it showed.
    if (viaMachine && machine.fileBase && machine.token)
      void engineMachine.player.stop(machine.fileBase, machine.token);
    setNow(null);
    setLoadedEnginePath(null);
    setMachineState(null);
    setBrowserAt(0);
    setEngineAt(0);
    setDuration(0);
  }, [ours, engine, viaMachine, machine.fileBase, machine.token]);

  const value = useMemo<Playback>(
    () => ({
      now,
      playing,
      position,
      // mpv has already read the file, so its duration wins when present (../../docs/playback.md).
      duration:
        viaMachine && machineState?.duration ? machineState.duration : duration,
      error,
      ended,
      start,
      toggle,
      seek,
      close,
      ...playQueue,
    }),
    [
      now,
      playing,
      position,
      duration,
      viaMachine,
      machineState,
      error,
      ended,
      start,
      toggle,
      seek,
      close,
      playQueue,
    ],
  );

  return (
    <EngineContext.Provider value={engine}>
      <PlaybackContext.Provider value={value}>
        {/* Mounted whichever destination plays: it is what reports the duration (../../docs/playback.md). */}
        {now ? (
          // biome-ignore lint/a11y/useMediaCaption: a song master has no caption track
          <audio
            ref={audioRef}
            src={library.fileUrl(now.path)}
            preload="metadata"
            onPlay={() => setBrowserPlaying(true)}
            onPause={() => setBrowserPlaying(false)}
            // The exact signal on this side: it fires for a song reaching its end and nothing else.
            onEnded={() => {
              setBrowserPlaying(false);
              setEnded((n) => n + 1);
            }}
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
              // Whatever `start` asked for, now that there is something to ask it of.
              if (pendingSeek.current) {
                e.currentTarget.currentTime = pendingSeek.current;
                pendingSeek.current = 0;
              }
              if (wantPlay.current && now.target === "browser") {
                wantPlay.current = false;
                void e.currentTarget.play().catch(() => {});
              }
            }}
            onTimeUpdate={(e) => {
              if (!browserPlaying) setBrowserAt(e.currentTarget.currentTime);
            }}
            // A master that will not load is silence too, and the bar is the only thing left to say so.
            onError={() =>
              setError("lecture impossible : le master n'a pas pu être chargé")
            }
          />
        ) : null}
        {children}
      </PlaybackContext.Provider>
    </EngineContext.Provider>
  );
}
