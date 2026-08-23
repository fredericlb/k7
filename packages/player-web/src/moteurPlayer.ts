// moteurPlayer.ts — the third engine behind the Player seam: z0's playback driven by
// engine/moteur instead of by Web Audio. The sound comes out of the ENGINE's interface, not
// the tab's; a browser that also wants to hear it subscribes to the étape-7 broadcast.
// See docs/moteurPlayer.md for what it cannot do.

import type { EngineClient } from "@studio/engine-browser";
import { clipDoc, emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { planEffects } from "./moteurEffects";
import type { Player } from "./player";
import type { PreloaderState, SongEntry } from "./songPreloader";

/** One chain per deck. Two, because playDual is a thing the game does. */
const DECKS = ["deck-a", "deck-b"] as const;

export interface MoteurPlayerOptions {
  /** z0's song path as an ABSOLUTE path on the engine's machine, with no default (../docs/moteurPlayer.md). */
  resolvePath: (path: string) => string | null;
}

const EMPTY: PreloaderState = {
  total: 0,
  loaded: 0,
  loading: false,
  progress: 0,
  isPlaying: false,
  isPaused: false,
  failedPaths: [],
};

/** Playback on the engine, with no decode and no preload — applying a doc IS the load (../docs/moteurPlayer.md). */
export class MoteurPlayer implements Player {
  private engine: EngineClient;
  private resolvePath: MoteurPlayerOptions["resolvePath"];
  private state: PreloaderState = { ...EMPTY };
  private listeners = new Set<() => void>();
  private effects: Record<string, number> = {};
  /** What is loaded on each deck, so a verb rebuilds the doc; an empty string is a deck carrying nothing. */
  private loaded: string[] = ["", ""];
  private gains: number[] = [1, 1];
  private muted = new Set<number>();
  private offConnected?: () => void;
  private offState?: () => void;

  constructor(engine: EngineClient, opts: MoteurPlayerOptions) {
    this.engine = engine;
    this.resolvePath = opts.resolvePath;
    // The engine's transport is the truth about whether sound is happening (../docs/moteurPlayer.md).
    this.offState = engine.onState((s) => {
      this.patch({ isPlaying: s.playing, isPaused: false });
    });
    this.offConnected = engine.onConnected((c) => {
      if (!c) this.patch({ isPlaying: false, loading: false });
    });
  }

  // --- the reactive snapshot ------------------------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): PreloaderState => this.state;

  private patch(next: Partial<PreloaderState>): void {
    // A NEW object every time: useSyncExternalStore compares by identity.
    this.state = { ...this.state, ...next };
    for (const cb of this.listeners) cb();
  }

  // --- loading --------------------------------------------------------------

  async preloadSong(song: SongEntry): Promise<void> {
    const paths = [
      song.path,
      song.fullSong,
      ...(song.tracks ?? []).flatMap((t) => [t.path, t.fullSong]),
    ].filter((p): p is string => Boolean(p));
    const missing = paths.filter((p) => !this.resolvePath(p));
    this.patch({
      total: paths.length,
      loaded: paths.length - missing.length,
      progress: paths.length
        ? (paths.length - missing.length) / paths.length
        : 1,
      loading: false,
      // Reported BEFORE the round starts: the engine cannot fetch what this machine has not cached.
      failedPaths: missing,
    });
  }

  unload(): void {
    this.loaded = ["", ""];
    this.muted.clear();
    this.engine.flush();
    this.patch({ ...EMPTY });
  }

  // --- playing --------------------------------------------------------------

  private doc(
    decks: { path: string; from?: number; to?: number }[],
  ): ProjectDoc | { error: string } {
    const tracks = [];
    for (let i = 0; i < decks.length && i < DECKS.length; i++) {
      const d = decks[i];
      const abs = this.resolvePath(d.path);
      if (!abs)
        return { error: `not cached on the engine's machine: ${d.path}` };
      const chain = DECKS[i];
      const { plugins } = planEffects(chain, this.effects);
      tracks.push(
        trackDoc(chain, {
          name: chain,
          mute: this.muted.has(i),
          // dB, and the interface hands a 0..1 linear gain: 1 is unity, 0 is -inf.
          inputGain: this.gains[i] > 0 ? 20 * Math.log10(this.gains[i]) : -100,
          clips: [
            clipDoc({
              id: `${chain}-clip`,
              type: "audio",
              name: chain,
              source: abs,
              // The song's window in SECONDS, unlike everything else in the document, which is beats.
              ...(d.from !== undefined ? { sourceFrom: d.from } : {}),
              ...(d.to !== undefined ? { sourceTo: d.to } : {}),
            }),
          ],
          plugins,
        }),
      );
    }
    return emptyDoc({ name: "z0", tracks });
  }

  private async start(
    decks: { path: string; from?: number; to?: number }[],
  ): Promise<void> {
    const { unsupported } = planEffects(DECKS[0], this.effects);
    const built = this.doc(decks);
    if ("error" in built) {
      this.patch({ failedPaths: decks.map((d) => d.path), isPlaying: false });
      throw new Error(built.error);
    }
    this.loaded = decks.map((d) => d.path);
    this.patch({ loading: true, unsupported });
    this.engine.sendProject(built);
    this.engine.transport("play");
    this.patch({ loading: false });
  }

  play(path: string, from?: number, to?: number): Promise<void> {
    return this.start([{ path, from, to }]);
  }

  playMulti(tracks: { path: string; from?: number }[]): Promise<void> {
    // Refused rather than truncated: a stem that never sounds is a wrong answer (../docs/moteurPlayer.md).
    if (tracks.length > DECKS.length)
      return Promise.reject(
        new Error(
          `the moteur player carries ${DECKS.length} decks; asked for ${tracks.length}`,
        ),
      );
    return this.start(tracks);
  }

  playDual(
    path1: string,
    path2: string,
    from?: number,
    to?: number,
    from2?: number,
  ): Promise<void> {
    return this.start([
      { path: path1, from, to },
      { path: path2, from: from2 },
    ]);
  }

  /** Refused LOUDLY: the engine has no reverse, and playing forwards would give the round away. */
  playReversed(): Promise<void> {
    return Promise.reject(
      new Error(
        "the moteur player cannot play reversed — see packages/player-web/docs/moteurPlayer.md",
      ),
    );
  }

  stop(): void {
    this.engine.transport("stop");
    this.patch({ isPlaying: false, isPaused: false });
  }

  // --- the knobs ------------------------------------------------------------

  setEffects(effects: Record<string, number>): void {
    this.effects = { ...effects };
    const { unsupported } = planEffects(DECKS[0], this.effects);
    this.patch({ unsupported });
    // Re-applied live: the engine diffs, so a slider move rebuilds the chain and not the song.
    if (this.loaded[0]) {
      const built = this.doc(
        this.loaded.filter(Boolean).map((path) => ({ path })),
      );
      if (!("error" in built)) this.engine.sendProject(built);
    }
  }

  muteMultiTrack(index: number): void {
    if (this.muted.has(index)) this.muted.delete(index);
    else this.muted.add(index);
    this.setEffects(this.effects); // rebuilds and resends
  }

  setGain(value: number): void {
    this.gains[0] = value;
    this.setEffects(this.effects);
  }

  setSecondGain(value: number): void {
    this.gains[1] = value;
    this.setEffects(this.effects);
  }

  /** Nothing to resume: the audio context is the engine's, and it was open before the page was. */
  resumeContext(): void {}

  dispose(): void {
    this.offState?.();
    this.offConnected?.();
    this.listeners.clear();
  }
}
