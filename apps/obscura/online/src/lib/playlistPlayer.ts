import type { Player } from "@studio/player-web";
import type { PreloaderState, SongEntry } from "@studio/player-web/preloader";

// Playlist-mode playback: two rotating <audio> elements (one playing, one
// prefetching the next track) instead of SongPreloader's decoded AudioBuffers.
// Streaming is what makes long playlists viable — a decoded 30 s stereo
// preview costs ~10 MB of RAM, so 50 tracks would blow past half a gigabyte.
// The trade-off is that no Web Audio effect can apply; playlist mode has none.

const READY_TIMEOUT_MS = 15_000;

export class PlaylistPlayer implements Player {
  private state: PreloaderState = {
    total: 0,
    loaded: 0,
    loading: false,
    progress: 1,
    isPlaying: false,
    isPaused: false,
    failedPaths: [],
  };
  private listeners = new Set<() => void>();

  // [current, spare] — play() swaps them so the element that prefetched the
  // upcoming track becomes the one that plays it.
  private els: HTMLAudioElement[] = [makeAudio(), makeAudio()];
  private gain = 1;
  private stopTimer: number | null = null;
  private playToken = 0;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): PreloaderState => this.state;

  private set(patch: Partial<PreloaderState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private get current(): HTMLAudioElement {
    return this.els[0];
  }

  /** The element already holding `src`, if any — that's the prefetched one. */
  private elementFor(src: string): HTMLAudioElement | null {
    const abs = new URL(src, window.location.href).href;
    return this.els.find((e) => e.src === abs) ?? null;
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  // ─── loading ──────────────────────────────────────────────────────────────

  /**
   * Warm one track on the spare element. Resolves on `canplaythrough`, on
   * error, or on a timeout — never rejects, because SoloGame's intro gate
   * waits on this and a dead track must not freeze the game.
   */
  private warm(el: HTMLAudioElement, src: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (failed: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener("canplaythrough", onOk);
        el.removeEventListener("error", onErr);
        if (failed && !this.state.failedPaths.includes(src)) {
          this.set({ failedPaths: [...this.state.failedPaths, src] });
        }
        const loaded = this.state.loaded + 1;
        this.set({
          loaded,
          progress: this.state.total === 0 ? 1 : loaded / this.state.total,
        });
        resolve();
      };
      const onOk = () => finish(false);
      const onErr = () => {
        console.warn("[playlist] failed to load", src);
        finish(true);
      };
      const timer = window.setTimeout(() => finish(false), READY_TIMEOUT_MS);
      el.addEventListener("canplaythrough", onOk);
      el.addEventListener("error", onErr);
      el.src = src;
      el.load();
    });
  }

  async preloadSong(song: SongEntry): Promise<void> {
    const src = song.path;
    if (!src || this.elementFor(src)) {
      // Nothing to fetch — unblock the intro gate, which waits on progress.
      if (this.state.total === 0) this.set({ progress: 1 });
      return;
    }
    this.set({ total: this.state.total + 1, loading: true });
    // Never touch the element that's mid-playback.
    const spare = this.els[1];
    try {
      await this.warm(spare, src);
    } finally {
      this.set({ loading: this.state.loaded < this.state.total });
    }
  }

  unload(): void {
    this.clearStopTimer();
    for (const el of this.els) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    // progress 0, like SongPreloader: the intro's Start button stays disabled
    // until the first track has actually buffered.
    this.set({
      total: 0,
      loaded: 0,
      loading: false,
      progress: 0,
      failedPaths: [],
    });
  }

  // ─── playback ─────────────────────────────────────────────────────────────

  async play(path: string, from = 0, to = 0): Promise<void> {
    // stop() bumps the token too, so claim ours after it.
    this.stop();
    const token = ++this.playToken;

    const abs = new URL(path, window.location.href).href;
    const prefetched = this.els.find((e) => e.src === abs) ?? null;
    if (prefetched && prefetched !== this.current) this.els.reverse();
    const el = this.current;
    if (el.src !== abs) {
      el.src = path;
      el.load();
    }
    el.volume = this.gain;
    try {
      el.currentTime = from;
    } catch {
      // Seeking before metadata lands throws; `from` is 0 for previews anyway.
    }
    try {
      await el.play();
    } catch (e) {
      console.warn("[playlist] play rejected", e);
      return;
    }
    if (token !== this.playToken) {
      el.pause();
      return;
    }
    el.onended = () => {
      if (token === this.playToken) this.set({ isPlaying: false });
    };
    this.set({ isPlaying: true, isPaused: false });
    if (to > from) {
      this.stopTimer = window.setTimeout(() => this.stop(), (to - from) * 1000);
    }
  }

  stop(): void {
    this.clearStopTimer();
    this.playToken++;
    for (const el of this.els) {
      if (!el.paused) el.pause();
    }
    this.set({ isPlaying: false });
  }

  /**
   * Unlock autoplay: browsers only allow programmatic play() once an element
   * has been played inside a user gesture. SoloGame calls this synchronously
   * from the Start click, before any await.
   */
  resumeContext(): void {
    for (const el of this.els) {
      const p = el.play();
      if (p && typeof p.then === "function") {
        void p.then(() => el.pause()).catch(() => {});
      }
    }
  }

  setGain(value: number): void {
    this.gain = Math.max(0, Math.min(1, value));
    for (const el of this.els) el.volume = this.gain;
  }

  // ─── unreachable in playlist mode ─────────────────────────────────────────
  // Every playlist category is built with mode "", so SoloGame never routes
  // here. They delegate rather than throw, in case a mode ever leaks in.

  setEffects(_effects: Record<string, number>): void {}
  setSecondGain(_value: number): void {}
  muteMultiTrack(_index: number): void {}

  playReversed(path: string, from = 0, to = 0): Promise<void> {
    return this.play(path, from, to);
  }

  playMulti(tracks: { path: string; from?: number }[]): Promise<void> {
    const first = tracks[0];
    return first ? this.play(first.path, first.from ?? 0) : Promise.resolve();
  }

  playDual(path1: string, _path2: string, from = 0, to = 0): Promise<void> {
    return this.play(path1, from, to);
  }
}

function makeAudio(): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  return el;
}
