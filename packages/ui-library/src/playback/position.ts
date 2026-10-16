// position.ts — where the transport is in the song, and how long the song is, kept OUTSIDE the
// playback context: the position moves up to 60 times a second, and a value in that context
// re-renders every screen that merely wants to know what is playing. Only the readers of this
// store re-render with it. See ../../docs/playback.md.

import { createContext, useContext, useSyncExternalStore } from "react";

export interface PlaybackPosition {
  /** Seconds into the song. */
  position: number;
  /** Seconds, or 0 before the master's metadata has arrived. */
  duration: number;
}

const AT_REST: PlaybackPosition = { position: 0, duration: 0 };

/** A value and its listeners; a write that changes nothing notifies nobody. */
export class PositionStore {
  private state: PlaybackPosition = AT_REST;
  private listeners = new Set<() => void>();

  get = (): PlaybackPosition => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  set(patch: Partial<PlaybackPosition>): void {
    const next = { ...this.state, ...patch };
    if (
      next.position === this.state.position &&
      next.duration === this.state.duration
    )
      return;
    this.state = next;
    for (const fn of this.listeners) fn();
  }
}

export const PositionContext = createContext<PositionStore | null>(null);

const noSubscribe = () => () => {};
const atRest = () => AT_REST;

/** The transport's position and the song's length; `follow: false` reads 0 and never re-renders, for a pane not showing what plays. */
export function usePlaybackPosition(follow = true): PlaybackPosition {
  const store = useContext(PositionContext);
  if (!store) throw new Error("usePlaybackPosition outside PlaybackProvider");
  return useSyncExternalStore(
    follow ? store.subscribe : noSubscribe,
    follow ? store.get : atRest,
  );
}
