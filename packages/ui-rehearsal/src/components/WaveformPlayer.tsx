// A track drawn rather than chromed: the browser's own transport is replaced by the track's SHAPE,
// which seeks where you click, and by the one thing a click cannot say — stop — under it.
//
// The shape is measured by the backend and kept there; a track whose shape cannot be had still
// plays, it just draws nothing. A list mounts many of these, so nothing downloads before a play.
// See ../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { Pause, Play } from "@frediverse/ui/icons";
import { Waveform } from "@studio/recorder";
import { useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import type { SongEnvelope } from "../types";

interface Props {
  src: string;
  /** Its shape, asked once per source — a failure here is a drawing problem, never a silence. */
  shapeOf: () => Promise<SongEnvelope>;
}

// The element playing right now, page-wide: starting one track stops the one before.
let current: HTMLAudioElement | null = null;

export function WaveformPlayer({ src, shapeOf }: Props) {
  const element = useRef<HTMLAudioElement | null>(null);
  const [shape, setShape] = useState<SongEnvelope | null>(null);
  const [shapeState, setShapeState] = useState<"loading" | "ready" | "none">(
    "loading",
  );
  const [time, setTime] = useState(0);
  const [running, setRunning] = useState(false);
  const [buffering, setBuffering] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `src` is the TRIGGER — another file has another shape.
  useEffect(() => {
    let alive = true;
    setShape(null);
    setShapeState("loading");
    void shapeOf()
      .then((s) => {
        if (!alive) return;
        setShape(s);
        setShapeState("ready");
      })
      .catch(() => alive && setShapeState("none"));
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const tick = () => setTime(el.currentTime);
    const sync = () => setRunning(!el.paused);
    const started = () => {
      if (current && current !== el) current.pause();
      current = el;
      sync();
    };
    const waiting = () => setBuffering(true);
    const flowing = () => setBuffering(false);
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    el.addEventListener("play", started);
    el.addEventListener("pause", sync);
    // The end pauses the element without a `pause` event, and the button would stay on ⏸.
    el.addEventListener("ended", sync);
    el.addEventListener("waiting", waiting);
    el.addEventListener("playing", flowing);
    el.addEventListener("pause", flowing);
    el.addEventListener("error", flowing);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("seeked", tick);
      el.removeEventListener("play", started);
      el.removeEventListener("pause", sync);
      el.removeEventListener("ended", sync);
      el.removeEventListener("waiting", waiting);
      el.removeEventListener("playing", flowing);
      el.removeEventListener("pause", flowing);
      el.removeEventListener("error", flowing);
      if (current === el) current = null;
    };
  }, []);

  /** A click on the shape goes there and plays: seeking and starting are one gesture. */
  const seek = (seconds: number) => {
    const el = element.current;
    if (!el) return;
    el.currentTime = seconds;
    setTime(seconds);
    // `waiting` does not fire for a first load under preload="none", so say so ourselves.
    if (el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) setBuffering(true);
    void el.play();
  };

  const toggle = () => {
    const el = element.current;
    if (!el) return;
    if (el.paused) {
      if (el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) setBuffering(true);
      void el.play();
    } else el.pause();
  };

  return (
    <div className="waveform-player">
      <audio
        ref={element}
        crossOrigin="use-credentials"
        preload="none"
        src={src}
      >
        <track kind="captions" />
      </audio>

      {shapeState === "loading" && (
        <div className="waveform-player-pending" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="muted small">{m["player.loadingWaveform"]()}</span>
        </div>
      )}
      {shape && (
        <Waveform
          envelope={shape}
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
        aria-busy={buffering}
      >
        {buffering ? (
          <>
            <span className="spinner" aria-hidden="true" />{" "}
            {m["common.loading"]()}
          </>
        ) : running ? (
          <>
            <Pause className="size-4" /> {m["common.pause"]()}
          </>
        ) : (
          <>
            <Play className="size-4" /> {m["common.play"]()}
          </>
        )}
      </Button>
    </div>
  );
}
