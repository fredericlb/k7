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
import { library } from "../api";
import { chainPreviewDoc } from "../engine/chainPreview";
import { type ModuleEngine, useModuleEngine } from "../engine/useModuleEngine";
import type { QueueItem } from "./queue";
import type { PlaybackTarget } from "./targets";
import type { PlayQueue } from "./usePlayQueue";

/** What is loaded, wherever it plays. */
export interface NowPlaying {
  entry: MediatekEntry;
  /** The médiathèque-relative path of the version that is loaded — the master, or whichever
   *  one the player's strip points at. The identity of what is loaded, and the `<audio>`
   *  source. Two songs can share a name; they cannot share this. */
  path: string;
  /** The version's own name, when it is not the master — the sidecar's key, which is what the
   *  player's tabs are labelled with. The engine's session is shared with everything else st0
   *  auditions, so three documents named after one song would be indistinguishable in its log.
   *  Absent for the master, whose document is the song. */
  version?: string;
  /** Where it is ACTUALLY playing — the caller resolves the fallback, since it is the caller
   *  that knows whether an engine answered. */
  target: PlaybackTarget;
  /** The same master as a path on the engine's machine, when that is what is playing it.
   *  Resolved by the caller, which is what knows about caches. Null in the browser. */
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
  /** Why nothing is coming out, when the browser is the one playing and the master would not
   *  load. Empty otherwise. The engine's own complaints are on `useEngine().warning`. */
  error: string;
  /**
   * Bumped each time what was loaded reached its end BY ITSELF. A counter and not a boolean:
   * what a reader wants is the event, and a flag would have to be cleared by whoever saw it.
   *
   * It exists for the playlist pane, which is the only thing here that has a next. Nothing
   * else has to care — `now` is deliberately not cleared, since "what did I just listen to"
   * outlives the last sample.
   */
  ended: number;
  /** Silence it and forget it. The bar's close button, and the only thing that clears `now`:
   *  a song that ENDS stays, because "what did I just listen to" outlives the last sample. */
  close: () => void;

  /**
   * Ce qui passera ensuite.
   *
   * Ici, à côté du transport, et pour la même raison que lui : une file d'attente doit
   * survivre à l'écran qui l'a remplie — on ajoute un morceau depuis l'arbre des Morceaux et
   * on continue à naviguer. Elle vit dans l'onglet, pas sur le serveur : c'est ce qu'on écoute
   * maintenant, pas un document. Une playlist, elle, est un fichier
   * (packages/mediatek/docs/playlists.md).
   */
  queue: QueueItem[];
  /** Mettre à la suite, sans doublon. */
  enqueue: (entries: MediatekEntry[]) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  /** Prendre la tête de la file et la retirer, ou `null`. Ce que fait l'avance automatique. */
  takeNext: () => QueueItem | null;

  /**
   * Dire « c'est moi qui décide de la suite », et rendre de quoi le relâcher.
   *
   * Deux choses savent enchaîner : le panneau d'une playlist et cette file. Toutes deux
   * regardent `ended`, aucune ne voit l'autre, et sans arbitrage les deux démarreraient un
   * morceau sur le même événement — le dernier écrit gagnerait, au hasard. Le panneau prend
   * donc la main tant qu'il pilote, et la file s'efface pendant ce temps.
   */
  claimAdvance: () => () => void;
  /** Quelqu'un d'autre enchaîne-t-il ? Lu par l'avance de la file, qui s'abstient alors. */
  advanceClaimed: boolean;
}

/** What the engine calls what we sent it. The version is IN the name because that session is
 *  shared: two versions of one song under one name are two lines nobody can tell apart. */
const docNameOf = (n: NowPlaying) =>
  n.version ? `${n.entry.name} · ${n.version}` : n.entry.name;

const EngineContext = createContext<ModuleEngine | null>(null);
const PlaybackContext = createContext<Playback | null>(null);

/**
 * The engine this tab drives, and there is exactly ONE.
 *
 * It used to be opened per screen — the module editor's, the song editor's, the engine page's
 * — which was safe only because those screens replaced each other. A song that keeps playing
 * while you browse breaks that arrangement outright: its transport has to outlive the screen
 * that started it, and a second socket would then be a second client on the same session,
 * driving the same project. So it is held here, once, and handed out.
 */
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
  children,
}: {
  /** The account's chosen engine, from the header's picker. */
  engineId?: string;
  /** La file d'attente, tenue PLUS HAUT — la Library rend ce provider, donc elle est au-dessus
   *  du contexte, et c'est elle qui porte l'arbre dont le clic droit la remplit. Voir
   *  ./usePlayQueue.ts. */
  playQueue: PlayQueue;
  children: ReactNode;
}) {
  const engine = useModuleEngine(engineId);
  const audioRef = useRef<HTMLAudioElement>(null);
  // What `start` asked for, applied once the element is ready for it. Refs and not state: they
  // are consumed by an event handler, and re-rendering for them would change nothing on screen.
  const pendingSeek = useRef(0);
  const wantPlay = useRef(false);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [browserPlaying, setBrowserPlaying] = useState(false);
  const [browserAt, setBrowserAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(0);
  /**
   * That the transport is about to stop because WE asked it to.
   *
   * Only the engine branch needs it. The browser has `onEnded`, which fires for the end of a
   * song and for nothing else; the engine has one bit — `playing` — which goes false when the
   * machine reaches the end AND when it is told to stop, and a queue must only advance on the
   * first. Set by every deliberate transition below, cleared by the effect that reads it.
   */
  const weStopped = useRef(false);
  const wasPlaying = useRef(false);
  // The document the engine holds for US, so its playhead can be told apart from another
  // surface's. Null means "the engine is not playing our song", whatever else it is doing.
  const [loadedEnginePath, setLoadedEnginePath] = useState<string | null>(null);
  // Where the engine was asked to be. The state frame is ~20 Hz, so between the ask and the
  // first frame this is the only honest answer.
  const [engineAt, setEngineAt] = useState(0);

  const viaEngine = now?.target === "engine";
  const ours =
    viaEngine && !!now?.enginePath && loadedEnginePath === now.enginePath;

  useEffect(() => {
    if (ours && engine.playing) setEngineAt(engine.playhead);
  }, [ours, engine.playing, engine.playhead]);

  // Follow the browser's playhead smoothly — `timeupdate` fires ~4×/s, which reads as a
  // stutter on a waveform. The engine's own frame arrives fast enough to need no such loop.
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

  const playing = viaEngine ? ours && engine.playing : browserPlaying;
  const position = viaEngine ? engineAt : browserAt;

  // The engine reaching the end of what it was given. Inferred, because the machine reports a
  // transport and not an event — see `weStopped` for the one case that has to be told apart.
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
      // Whatever the transport does in the next moment, it does because of this call — so it
      // is not the end of a song, even when it looks exactly like one.
      weStopped.current = true;
      if (what.target === "engine") {
        if (!what.enginePath) return;
        audioRef.current?.pause();
        // A clean edit for a document this session has not held: an apply is a diff, and a
        // diff cannot remove a plugin the engine's stored document never mentioned. See
        // useModuleEngine's `reset`.
        if (loadedEnginePath !== what.enginePath) engine.reset();
        setLoadedEnginePath(what.enginePath);
        setEngineAt(from);
        engine.play(
          chainPreviewDoc(what.enginePath, docNameOf(what), []),
          from,
        );
        return;
      }
      // The engine keeps whatever it had; it is simply no longer what we are listening to.
      if (ours) engine.stop();
      setLoadedEnginePath(null);
      setBrowserAt(from);
      const el = audioRef.current;
      if (el && now?.path === what.path) {
        // The same master, already loaded: `src` will not change, so no metadata event is
        // coming and waiting for one would be waiting forever. Replaying a song from the bar
        // is exactly this case.
        el.currentTime = from;
        void el.play().catch(() => {});
        return;
      }
      // A different master. The element has not seen the new `src` at this point in the
      // commit, so the position and the play are applied when its metadata lands.
      pendingSeek.current = from;
      wantPlay.current = true;
    },
    [engine, ours, loadedEnginePath, now?.path],
  );

  const toggle = useCallback(() => {
    if (!now) return;
    weStopped.current = true; // asked for, either way — see the ref
    if (viaEngine) {
      if (ours && engine.playing) return engine.stop();
      if (!now.enginePath) return;
      // Past the end, a resume would roll over nothing: the engine does not rewind on play.
      const from = duration && engineAt >= duration - 0.25 ? 0 : engineAt;
      if (loadedEnginePath !== now.enginePath) engine.reset();
      setLoadedEnginePath(now.enginePath);
      setEngineAt(from);
      engine.play(chainPreviewDoc(now.enginePath, docNameOf(now), []), from);
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    // `play()` on an element sitting at the end rewinds by itself, which is the behaviour a
    // bar that survives the end of a song needs.
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [now, viaEngine, ours, engine, duration, engineAt, loadedEnginePath]);

  const seek = useCallback(
    (seconds: number) => {
      const at = Math.max(0, seconds);
      if (viaEngine) {
        setEngineAt(at);
        if (ours) engine.seek(at);
        return;
      }
      const el = audioRef.current;
      if (el) el.currentTime = at;
      setBrowserAt(at);
    },
    [viaEngine, ours, engine],
  );

  const close = useCallback(() => {
    weStopped.current = true;
    audioRef.current?.pause();
    if (ours) engine.stop();
    setNow(null);
    setLoadedEnginePath(null);
    setBrowserAt(0);
    setEngineAt(0);
    setDuration(0);
  }, [ours, engine]);

  // Un COMPTEUR de revendications et non un booléen : deux panneaux de playlist peuvent être
  // montés le temps d'une transition d'écran, et le démontage du premier remettrait un
  // booléen à faux alors que le second pilote encore.
  const [claims, setClaims] = useState(0);
  const claimAdvance = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => Math.max(0, n - 1));
  }, []);

  const value = useMemo<Playback>(
    () => ({
      now,
      playing,
      position,
      duration,
      error,
      ended,
      start,
      toggle,
      seek,
      close,
      ...playQueue,
      claimAdvance,
      advanceClaimed: claims > 0,
    }),
    [
      now,
      playing,
      position,
      duration,
      error,
      ended,
      start,
      toggle,
      seek,
      close,
      playQueue,
      claimAdvance,
      claims,
    ],
  );

  return (
    <EngineContext.Provider value={engine}>
      <PlaybackContext.Provider value={value}>
        {/* Mounted for whatever is loaded, whichever destination plays it: it is what reports
            the master's duration — the engine's state frame carries a playhead and no length —
            and keeping it here is what lets a song outlive the screen that started it. */}
        {now ? (
          // biome-ignore lint/a11y/useMediaCaption: a song master has no caption track
          <audio
            ref={audioRef}
            src={library.fileUrl(now.path)}
            preload="metadata"
            onPlay={() => setBrowserPlaying(true)}
            onPause={() => setBrowserPlaying(false)}
            // The exact signal, on this side: it fires for a song reaching its end and for
            // nothing else, which is why only the engine branch has to infer one.
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
            // A master that will not load is silence too, and the bar is the only thing on
            // screen that can say so once the song's own pane has been left behind.
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
