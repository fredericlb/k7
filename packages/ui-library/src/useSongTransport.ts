// useSongTransport.ts — the song page's hold on the app's one transport: which version is open,
// where its cursor rests, and the play button, seek and line taps that drive it. Shared by the
// header's button, the waveform tab and the followed lyrics, so the three agree on one version.
// It reads no position: only the components drawing one subscribe to it. See ../docs/songPlayer.md.

import { ORIGINAL, type Take, takesOf } from "@studio/mediatek/takes";
import type { MediatekEntry } from "@studio/mediatek/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayback } from "./playback/PlaybackProvider";
import { effectiveTarget, type PlaybackTarget } from "./playback/targets";

export interface SongTransport {
  takes: Take[];
  take: Take | undefined;
  choose: (name: string) => void;
  /** The open version's file, and its médiathèque path; null when it has none. */
  file: string | null;
  path: string | null;
  /** The open version is the one loaded. */
  isCurrent: boolean;
  /** Any version of this song is the one loaded — what the lyrics follow. */
  songLoaded: boolean;
  /** The open version sounds. */
  playing: boolean;
  /** Any version of this song sounds — what the header's button shows. */
  songPlaying: boolean;
  cursor: number;
  actual: PlaybackTarget;
  toggle: () => void;
  seek: (sec: number) => void;
  /** A tapped line: this song plays from there, started on the open version when it is not loaded. */
  playFrom: (sec: number) => void;
}

/** `base` is where the song streams from when it is not on this machine (songSource.ts). */
export function useSongTransport(
  entry: MediatekEntry,
  base?: string,
): SongTransport {
  const playback = usePlayback();
  const takes = useMemo<Take[]>(() => takesOf(entry), [entry]);
  // By NAME: the listing is re-polled, so an index would come to mean another version.
  const [tab, setTab] = useState(ORIGINAL);
  const take = takes.find((t) => t.name === tab) ?? takes[0];
  // biome-ignore lint/correctness/useExhaustiveDependencies: `entry.path` is the trigger, not a value read here
  useEffect(() => setTab(ORIGINAL), [entry.path]);

  const file = take?.file ?? null;
  const path = file ? `${entry.path}/${file}` : null;
  const isCurrent = !!path && playback.now?.path === path;
  const songLoaded = playback.now?.entry.path === entry.path;
  const [cursor, setCursor] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trigger is the version changing
  useEffect(() => setCursor(0), [path]);

  const actual = effectiveTarget(playback.engineAvailable, !!base);

  const startAt = useCallback(
    (from: number) => {
      if (!path) return;
      playback.start(
        {
          entry,
          path,
          // The master's document is the song; every other tab names its version.
          version: take?.kind === "master" ? undefined : take?.name,
          base,
        },
        from,
      );
    },
    [path, playback, entry, take?.kind, take?.name, base],
  );

  const toggle = useCallback(() => {
    // Another version of this song sounding is paused, not replaced: the button speaks for the song.
    if (isCurrent || (songLoaded && playback.playing)) return playback.toggle();
    startAt(cursor);
  }, [isCurrent, songLoaded, playback, startAt, cursor]);

  const seek = useCallback(
    (sec: number) => {
      if (isCurrent) return playback.seek(sec);
      setCursor(Math.max(0, sec));
    },
    [isCurrent, playback],
  );

  const playFrom = useCallback(
    (sec: number) => {
      const at = Math.max(0, sec);
      if (!songLoaded) return startAt(at);
      playback.seek(at);
      if (!playback.playing) playback.toggle();
    },
    [songLoaded, startAt, playback],
  );

  return {
    takes,
    take,
    choose: setTab,
    file,
    path,
    isCurrent,
    songLoaded,
    playing: isCurrent && playback.playing,
    songPlaying: songLoaded && playback.playing,
    cursor,
    actual,
    toggle,
    seek,
    playFrom,
  };
}
