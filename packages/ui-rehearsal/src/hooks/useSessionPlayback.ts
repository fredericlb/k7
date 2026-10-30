// useSessionPlayback.ts — a session's take played in its page: the hidden element, its playhead as
// a live value only the waveform and the clock read, its gain, and a range played to its end.

import { createLiveValue, usePlayheadLoop } from "@studio/recorder";
import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface Range {
  start: number;
  end: number;
}

/** The take's transport; `audioProps` go on the page's one `<audio>`. */
export function useSessionPlayback(
  session: { id: string; gain: number },
  seekTo: number | undefined,
) {
  // The playhead moves every frame, so it lives in a store only the waveform and the clock read.
  const [clock] = useState(() => createLiveValue(0));
  const [playing, setPlaying] = useState(false);
  // The range playRange last started, so its own button can read as Pause while it plays.
  const [playingRange, setPlayingRange] = useState<Range | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const seekApplied = useRef(false);
  const playCtx = useRef<AudioContext | null>(null);
  const gainNode = useRef<GainNode | null>(null);

  usePlayheadLoop(audioRef, playing, clock.set);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new session re-applies the seek even at the same second
  useEffect(() => {
    if (seekTo == null) return;
    seekApplied.current = false;
    const a = audioRef.current;
    if (a && a.readyState >= 1) {
      a.currentTime = seekTo;
      seekApplied.current = true;
    }
    clock.set(seekTo);
  }, [seekTo, session.id, clock]);

  // The element the graph was built on: an element is routed into ONE context for its life, so the graph follows it.
  const graphOf = useRef<HTMLAudioElement | null>(null);

  const ensurePlaybackGain = useCallback(() => {
    const a = audioRef.current;
    if (!a || (playCtx.current && graphOf.current === a)) return;
    // A new element (the page remounted it): the old graph serves nobody.
    playCtx.current?.close().catch(() => {});
    playCtx.current = null;
    gainNode.current = null;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(a);
      const g = ctx.createGain();
      g.gain.value = session.gain || 1;
      src.connect(g);
      g.connect(ctx.destination);
      playCtx.current = ctx;
      gainNode.current = g;
      graphOf.current = a;
    } catch {
      /* play at unity gain */
    }
  }, [session.gain]);

  useEffect(() => {
    if (gainNode.current) gainNode.current.gain.value = session.gain || 1;
  }, [session.gain]);

  // Torn down with the page, NOT per session: the same `<audio>` survives a session switched in place, and a closed context would keep it silent.
  useEffect(() => {
    return () => {
      playCtx.current?.close().catch(() => {});
      playCtx.current = null;
      gainNode.current = null;
      graphOf.current = null;
    };
  }, []);

  const seek = (sec: number) => {
    if (audioRef.current) audioRef.current.currentTime = sec;
    clock.set(sec);
  };

  // The one range listener live at a time: a range played after another must not be paused by the first one's.
  const rangeStop = useRef<(() => void) | null>(null);
  const clearRangeStop = () => {
    if (rangeStop.current)
      audioRef.current?.removeEventListener("timeupdate", rangeStop.current);
    rangeStop.current = null;
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      clearRangeStop(); // play-all runs to the end, not to a range someone played earlier
      setPlayingRange(null);
      ensurePlaybackGain();
      playCtx.current?.resume().catch(() => {});
      a.play();
    } else {
      a.pause();
    }
  };

  const playRange = (start: number, end: number) => {
    if (!audioRef.current) return;
    setPlayingRange({ start, end });
    ensurePlaybackGain();
    playCtx.current?.resume().catch(() => {});
    clearRangeStop();
    audioRef.current.currentTime = start;
    audioRef.current.play();
    const stopAt = () => {
      if (audioRef.current && audioRef.current.currentTime >= end) {
        audioRef.current.pause();
        clearRangeStop();
      }
    };
    rangeStop.current = stopAt;
    audioRef.current.addEventListener("timeupdate", stopAt);
  };

  const pause = () => audioRef.current?.pause();

  const audioProps = {
    ref: audioRef,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onTimeUpdate: (e: SyntheticEvent<HTMLAudioElement>) =>
      clock.set(e.currentTarget.currentTime),
    onLoadedMetadata: (e: SyntheticEvent<HTMLAudioElement>) => {
      if (seekTo != null && !seekApplied.current) {
        e.currentTarget.currentTime = seekTo;
        clock.set(seekTo);
        seekApplied.current = true;
      }
    },
  };

  return {
    clock,
    playing,
    playingRange,
    seek,
    togglePlay,
    playRange,
    pause,
    audioProps,
  };
}
