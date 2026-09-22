// A track drawn rather than chromed: the browser's own transport is replaced by the track's SHAPE,
// which seeks where you click, and by the one thing a click cannot say — stop — under it.
//
// The shape is measured by the backend and kept there; a track whose shape cannot be had still
// plays, it just draws nothing. See ../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { Waveform } from "@k7/recorder";
import { useEffect, useRef, useState } from "react";
import type { SongEnvelope } from "../types";

interface Props {
  src: string;
  /** Its shape, asked once per source — a failure here is a drawing problem, never a silence. */
  shapeOf: () => Promise<SongEnvelope>;
}

export function WaveformPlayer({ src, shapeOf }: Props) {
  const element = useRef<HTMLAudioElement | null>(null);
  const [shape, setShape] = useState<SongEnvelope | null>(null);
  const [time, setTime] = useState(0);
  const [running, setRunning] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `src` is the TRIGGER — another file has another shape.
  useEffect(() => {
    let alive = true;
    setShape(null);
    void shapeOf()
      .then((s) => alive && setShape(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const tick = () => setTime(el.currentTime);
    const sync = () => setRunning(!el.paused);
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    el.addEventListener("play", sync);
    el.addEventListener("pause", sync);
    // The end pauses the element without a `pause` event, and the button would stay on ⏸.
    el.addEventListener("ended", sync);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("seeked", tick);
      el.removeEventListener("play", sync);
      el.removeEventListener("pause", sync);
      el.removeEventListener("ended", sync);
    };
  }, []);

  /** A click on the shape goes there and plays: seeking and starting are one gesture. */
  const seek = (seconds: number) => {
    const el = element.current;
    if (!el) return;
    el.currentTime = seconds;
    void el.play();
  };

  const toggle = () => {
    const el = element.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div className="waveform-player">
      <audio ref={element} crossOrigin="use-credentials" src={src}>
        <track kind="captions" />
      </audio>

      {shape && (
        <Waveform
          envelope={{ intervalMs: shape.intervalMs, samples: shape.samples }}
          duration={shape.seconds}
          currentTime={time}
          height={64}
          onSeek={seek}
        />
      )}

      <Button
        variant="secondary"
        className="waveform-player-play"
        onClick={toggle}
        aria-pressed={running}
      >
        {running ? "⏸ Pause" : "▶ Play"}
      </Button>
    </div>
  );
}
