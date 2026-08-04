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
  /**
   * z0's song path as an ABSOLUTE FILE PATH on the engine's machine.
   *
   * Required, and not defaulted, because there is no honest guess: z0's paths are URLs
   * its own backend serves, and the engine opens files. In practice this resolves through
   * the médiathèque's local cache — which is exactly why the plan put this last, needing
   * "un moteur local sur une machine qui n'a aujourd'hui besoin que d'un navigateur".
   *
   * Returning null means "this machine does not have that song", which the player reports
   * rather than sending the engine a path it will warn about and then play silence for.
   */
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

/**
 * Playback on the engine, behind the same interface SongPreloader satisfies.
 *
 * The shape is deliberately unlike the Web Audio one: there is no decode, no buffer cache
 * and no preload worth the name, because applying a ProjectDoc IS the load — the engine
 * opens the file and instantiates the plugin chain when it receives the document. So
 * `preloadSong` sends a document and waits for the engine to say it applied it, and `play`
 * is a transport verb on a document that is already there.
 */
export class MoteurPlayer implements Player {
  private engine: EngineClient;
  private resolvePath: MoteurPlayerOptions["resolvePath"];
  private state: PreloaderState = { ...EMPTY };
  private listeners = new Set<() => void>();
  private effects: Record<string, number> = {};
  /** What is loaded on each deck, so a transport verb can rebuild the document without the
   *  caller re-supplying it. Empty string == that deck carries nothing. */
  private loaded: string[] = ["", ""];
  private gains: number[] = [1, 1];
  private muted = new Set<number>();
  private offConnected?: () => void;
  private offState?: () => void;

  constructor(engine: EngineClient, opts: MoteurPlayerOptions) {
    this.engine = engine;
    this.resolvePath = opts.resolvePath;
    // The engine's transport is the truth about whether sound is happening — not a flag
    // this class sets hopefully when it sends a play. A document that failed to load
    // leaves the transport stopped, and the UI must show that rather than a spinner.
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
    // A NEW object every time: useSyncExternalStore compares by identity, and mutating in
    // place is the classic way to make a store that never re-renders.
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
      // The engine cannot fetch what this machine has not cached, and a round that starts
      // on a song nobody can play is worse than one that refuses to start.
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
              // The song's window, in SECONDS into the file — which is what sourceFrom/To
              // measure, unlike everything else in the document, which is beats.
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
    // The game's multi mode is several stems of ONE song, muted individually. Two decks is
    // what the document shape here allows, so more than that is refused rather than
    // silently truncated to the first two — a stem that never sounds is a wrong answer.
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

  /**
   * Refused, loudly.
   *
   * The engine has no reverse: `ClipDoc` carries no such flag, and there is nothing in the
   * protocol to add one from here. The Web Audio player does it by building a reversed
   * AudioBuffer, which has no analogue in a document the engine reads from a file.
   *
   * Rejecting rather than playing forwards is the whole point. A reversed round played
   * forwards is one every player answers instantly, and nothing in the game would show why.
   */
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
    // Re-apply live: the engine diffs the document, so a slider move rebuilds only the
    // chain that changed rather than reloading the song.
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

  /** Nothing to resume: the audio context is the engine's, and it was open before the page
   *  was. Kept because the interface has it and the browser player genuinely needs it. */
  resumeContext(): void {}

  dispose(): void {
    this.offState?.();
    this.offConnected?.();
    this.listeners.clear();
  }
}
