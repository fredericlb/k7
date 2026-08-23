import { useSyncExternalStore } from "react";
import type { PreloaderState, SongEntry } from "./songPreloader";

// The playback surface SoloGame drives, satisfied structurally by three engines (../docs/moteurPlayer.md).

export interface Player {
  subscribe: (cb: () => void) => () => void;
  getState: () => PreloaderState;
  setEffects(effects: Record<string, number>): void;
  unload(): void;
  preloadSong(song: SongEntry): Promise<void>;
  play(path: string, from?: number, to?: number): Promise<void>;
  playReversed(path: string, from?: number, to?: number): Promise<void>;
  playMulti(tracks: { path: string; from?: number }[]): Promise<void>;
  playDual(
    path1: string,
    path2: string,
    from?: number,
    to?: number,
    from2?: number,
  ): Promise<void>;
  muteMultiTrack(index: number): void;
  stop(): void;
  resumeContext(): void;
  setGain(value: number): void;
  setSecondGain(value: number): void;
}

/** Hook: subscribe to a player's reactive snapshot. */
export function usePlayerState(p: Player): PreloaderState {
  return useSyncExternalStore(p.subscribe, p.getState);
}
