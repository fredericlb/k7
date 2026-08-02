import { useSyncExternalStore } from "react";
import type { WSMessage, WSSubscriber } from "./monitor";
import { SongPreloader } from "./songPreloader";

// Framework-free port of composables/useAudioPlayback.ts. Owns the
// SongPreloader engine and drives it from WS traffic (next / phase_change /
// audio_command); Vue watchers became explicit notifications: a preloader
// subscription re-broadcasts progress + transport state, and volume changes
// re-apply the gain inline.

interface Track {
  artist?: string;
  title?: string;
  path?: string;
  from?: number;
  to?: number;
  fullSong?: string;
}
export interface Song {
  artist: string;
  title: string;
  label?: string;
  path?: string;
  from?: number;
  to?: number;
  fullSong?: string;
  effects?: Record<string, number>;
  tracks?: Track[];
}
interface Category {
  name: string;
  mode?: string;
  songs?: Song[];
}
export interface NextItem {
  type: string;
  category?: Category;
  song?: Song;
  mode?: string;
  finished?: boolean;
}

export interface AudioUIState {
  masterGain: number;
  muted: boolean;
  currentLabel: string;
  currentMode: string;
}

export interface AudioPlaybackDeps {
  subscribe: (fn: WSSubscriber) => () => void;
  sendWS: (msg: { type: string; payload: unknown }) => void;
}

export class AudioPlayback {
  readonly preloader = new SongPreloader();

  private state: AudioUIState = {
    masterGain: 0.8,
    muted: false,
    currentLabel: "",
    currentMode: "",
  };
  private listeners = new Set<() => void>();

  // Read directly by GameState (no UI render depends on them).
  currentItem: NextItem | null = null;
  lastSongPath: string | null = null;
  lastSongFrom = 0;
  lastSongTo = 0;

  // Tracks the most recent preload so a subsequent song event waits for
  // its buffers to be cached before calling play().
  private pendingPreloadPromise: Promise<void> | null = null;

  // Fusion alternation timer state.
  private fusionTimers: number[] = [];

  private deps: AudioPlaybackDeps;
  private wsUnsub: () => void;
  private preloaderUnsub: () => void;
  private lastProgressBroadcast = 0;
  private prevSnapshot = this.preloader.getState();

  constructor(deps: AudioPlaybackDeps) {
    this.deps = deps;
    this.wsUnsub = deps.subscribe((msg: WSMessage) => {
      if (msg.type === "next") {
        void this.handleNext(msg.payload as unknown as NextItem);
      } else if (msg.type === "phase_change") {
        const p = (msg.payload as { phase?: string }).phase;
        if (p) this.handlePhaseChange(p);
      } else if (msg.type === "audio_command") {
        this.handleAudioCommand(msg.payload);
      }
    });
    this.preloaderUnsub = this.preloader.subscribe(() =>
      this.onPreloaderChange(),
    );
    // Mirrors the Vue `immediate: true` transport watcher — the remote gets
    // an initial playback_state as soon as the monitor boots.
    this.broadcastPlaybackState();
  }

  subscribeState = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): AudioUIState => this.state;

  private set(patch: Partial<AudioUIState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get masterGain(): number {
    return this.state.masterGain;
  }

  get currentMode(): string {
    return this.state.currentMode;
  }

  private onPreloaderChange(): void {
    const prev = this.prevSnapshot;
    const cur = this.preloader.getState();
    this.prevSnapshot = cur;

    // Broadcast preload progress so the presenter loading overlay still works.
    if (
      prev.loading !== cur.loading ||
      prev.progress !== cur.progress ||
      prev.loaded !== cur.loaded ||
      prev.total !== cur.total
    ) {
      const now = performance.now();
      if (!(now - this.lastProgressBroadcast < 100 && cur.loading)) {
        this.lastProgressBroadcast = now;
        this.deps.sendWS({
          type: "preload_progress",
          payload: {
            loading: cur.loading,
            progress: cur.progress,
            loaded: cur.loaded,
            total: cur.total,
          },
        });
      }
    }

    if (prev.failedPaths !== cur.failedPaths && cur.failedPaths.length > 0) {
      this.deps.sendWS({
        type: "preload_failed",
        payload: { paths: cur.failedPaths },
      });
    }

    // Broadcast playback transport state so the remote can toggle play/pause.
    if (prev.isPlaying !== cur.isPlaying || prev.isPaused !== cur.isPaused) {
      this.broadcastPlaybackState();
    }
  }

  private broadcastPlaybackState(): void {
    const s = this.preloader.getState();
    this.deps.sendWS({
      type: "playback_state",
      payload: { playing: s.isPlaying, paused: s.isPaused },
    });
  }

  clearFusionTimers = (): void => {
    for (const id of this.fusionTimers) clearTimeout(id);
    this.fusionTimers = [];
  };

  private applyVolume(): void {
    this.preloader.setGain(this.state.muted ? 0 : this.state.masterGain);
  }

  setVolume = (v: number): void => {
    this.set({ masterGain: Math.max(0, Math.min(1, v)) });
    this.applyVolume();
  };

  toggleMute = (): void => {
    this.set({ muted: !this.state.muted });
    this.applyVolume();
  };

  private songLabel(s?: Song): string {
    if (!s) return "";
    if (s.label) return s.label;
    return `${s.artist ?? ""} — ${s.title ?? ""}`.trim();
  }

  private startFusionAlternating(tracks: Track[]): void {
    this.clearFusionTimers();
    if (tracks.length < 2 || !tracks[0].path || !tracks[1].path) return;
    const p1 = tracks[0].path;
    const p2 = tracks[1].path;
    const f1 = tracks[0].from ?? 0;
    const t1 = tracks[0].to ?? 0;
    const f2 = tracks[1].from ?? 0;
    const t2 = tracks[1].to ?? 0;
    void this.preloader.playDual(p1, p2, f1, t1, f2, t2);
    this.preloader.setGain(this.state.masterGain);
    this.preloader.setSecondGain(0);
    let on1 = true;
    const tick = () => {
      on1 = !on1;
      if (on1) {
        this.preloader.setGain(this.state.masterGain);
        this.preloader.setSecondGain(0);
      } else {
        this.preloader.setGain(0);
        this.preloader.setSecondGain(this.state.masterGain);
      }
      this.fusionTimers.push(window.setTimeout(tick, 4000));
    };
    this.fusionTimers.push(window.setTimeout(tick, 4000));
  }

  private async handleNext(item: NextItem): Promise<void> {
    this.set({ currentLabel: "" });
    this.currentItem = item;
    if (item.finished || item.type === "end") {
      this.clearFusionTimers();
      this.preloader.stop();
      return;
    }

    if (item.type === "category" && item.category?.songs) {
      this.clearFusionTimers();
      this.preloader.stop();
      this.set({ currentMode: item.category.mode ?? "" });
      const songs = item.category.songs.filter(
        (s) => s.path || s.tracks?.length,
      );
      if (songs.length > 0) {
        this.pendingPreloadPromise = this.preloader
          .preloadCategory(songs)
          .catch((e) => console.error("preload failed:", e));
      }
      return;
    }

    if (item.type === "song" && item.song) {
      const mode = item.mode ?? this.state.currentMode;
      if (this.pendingPreloadPromise) {
        await this.pendingPreloadPromise;
        this.pendingPreloadPromise = null;
      }
      const from = item.song.from ?? 0;
      const to = item.song.to ?? 0;
      this.set({ currentLabel: this.songLabel(item.song) });
      this.lastSongPath = item.song.path ?? null;
      this.lastSongFrom = from;
      this.lastSongTo = to;
      this.clearFusionTimers();
      this.preloader.setEffects(item.song.effects ?? {});
      this.applyVolume();

      if (mode === "free") return;
      if (mode === "multi") {
        const tracks = (item.song.tracks ?? [])
          .filter((t): t is Track & { path: string } => !!t.path)
          .map((t) => ({ path: t.path, from: t.from ?? from }));
        if (tracks.length) void this.preloader.playMulti(tracks);
        return;
      }
      if (mode === "reversed") {
        if (item.song.path)
          void this.preloader.playReversed(item.song.path, from, to);
        return;
      }
      if (mode === "fusion") {
        const tracks = item.song.tracks ?? [];
        if (tracks.length >= 2) this.startFusionAlternating(tracks);
        else if (tracks.length === 1 && tracks[0].path)
          void this.preloader.play(
            tracks[0].path,
            tracks[0].from ?? from,
            tracks[0].to ?? to,
          );
        return;
      }
      if (item.song.path) void this.preloader.play(item.song.path, from, to);
    }
  }

  /**
   * Restart playback after a page reload mid-game. The backend doesn't
   * re-broadcast the current `next` event on connect, so on load we fetch
   * /api/game ourselves and replay it through handleNext, with the slot's
   * category songs preloaded first so the song event finds them in cache.
   */
  async recover(
    item: NextItem | null,
    categorySongs?: unknown[],
  ): Promise<void> {
    if (!item) return;
    if (categorySongs && categorySongs.length > 0) {
      this.pendingPreloadPromise = this.preloader
        .preloadCategory(categorySongs as never)
        .catch((e) => console.error("preload failed:", e));
    }
    if (item.mode) this.set({ currentMode: item.mode });
    await this.handleNext(item);
  }

  private handlePhaseChange(newPhase: string): void {
    if (newPhase === "answering") {
      // Mirrors useGameLogic: pause single playback, stop fusion, multi keeps playing.
      const mode = this.state.currentMode;
      if (mode === "fusion") {
        this.clearFusionTimers();
        this.preloader.stop();
      } else if (mode === "multi" || mode === "free") {
        /* keep playing */
      } else {
        this.preloader.pause();
      }
    }
  }

  private handleAudioCommand(payload: Record<string, unknown>): void {
    const action = payload.action as string | undefined;
    switch (action) {
      case "pause":
        this.preloader.pause();
        break;
      case "resume":
        if (this.lastSongPath) void this.preloader.resume(this.lastSongPath);
        break;
      case "play":
        if (!this.lastSongPath) break;
        if (this.preloader.getState().isPaused) {
          void this.preloader.resume(this.lastSongPath);
        } else {
          this.preloader.resumeContext();
          void this.preloader.play(
            this.lastSongPath,
            this.lastSongFrom,
            this.lastSongTo,
          );
        }
        break;
      case "replay":
        if (this.lastSongPath) {
          this.preloader.resumeContext();
          void this.preloader.play(
            this.lastSongPath,
            this.lastSongFrom,
            this.lastSongTo,
          );
        }
        break;
      case "stop":
        this.clearFusionTimers();
        this.preloader.stop();
        break;
      case "stop_multi":
        this.preloader.stopMulti();
        break;
      case "stop_second":
        this.preloader.stopSecond();
        break;
      case "set_gain": {
        const v = payload.value as number | undefined;
        if (typeof v === "number") this.setVolume(v);
        break;
      }
      case "set_playback_rate": {
        const v = payload.value as number | undefined;
        if (typeof v === "number") this.preloader.setPlaybackRate(v);
        break;
      }
      case "set_duck": {
        const v = payload.value as number | undefined;
        if (typeof v === "number") this.preloader.setDuck(v);
        break;
      }
      case "mute_multi_track": {
        const idx = payload.index as number | undefined;
        if (typeof idx === "number") this.preloader.muteMultiTrack(idx);
        break;
      }
      case "resume_context":
        this.preloader.resumeContext();
        break;
    }
  }

  dispose(): void {
    this.wsUnsub();
    this.preloaderUnsub();
    this.clearFusionTimers();
    this.preloader.stop();
  }
}

export function useAudioUIState(a: AudioPlayback): AudioUIState {
  return useSyncExternalStore(a.subscribeState, a.getState);
}
