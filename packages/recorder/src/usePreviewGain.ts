// usePreviewGain.ts — listening back mid-take at the level the finished session will play at.
// What reads wrong: a media element gives its source node once, so the graph lives as long as the recorder.

import { type RefObject, useEffect, useRef } from "react";

/** Returns the call that wires (once) and levels the preview; play it before every play(). */
export function usePreviewGain(
  audioRef: RefObject<HTMLAudioElement | null>,
  getGain: () => number,
) {
  const playCtx = useRef<AudioContext | null>(null);
  const gainNode = useRef<GainNode | null>(null);

  useEffect(
    () => () => {
      playCtx.current?.close().catch(() => {});
      playCtx.current = null;
      gainNode.current = null;
    },
    [],
  );

  return () => {
    const a = audioRef.current;
    if (!a) return;
    if (!playCtx.current) {
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaElementSource(a);
        const g = ctx.createGain();
        src.connect(g);
        g.connect(ctx.destination);
        playCtx.current = ctx;
        gainNode.current = g;
      } catch {
        return; // fall back to unity-gain playback
      }
    }
    if (gainNode.current) gainNode.current.gain.value = getGain();
    playCtx.current?.resume().catch(() => {});
  };
}
