import { Button } from "@frediverse/ui/button";
import { useEffect, useRef, useState } from "react";
import { fmtTime } from "./format";

interface Props {
  src: string; // extracted clip audio
  samples: number[]; // envelope samples covering just this moment
  intervalMs: number; // sample spacing of `samples`
}

const HEIGHT = 48;
const EDGE = 3; // px kept clear top/bottom
const BAR_STEP = 3; // px between bars
const BAR_WIDTH = 2;

/** A compact waveform player for a moment's clip, in place of the native audio element. */
export function MomentPlayer({ src, samples, intervalMs }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [width, setWidth] = useState(240);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(
    (samples.length * intervalMs) / 1000,
  );

  // Track container width so the canvas stays responsive.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.max(80, Math.floor(entries[0].contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Smoothly follow the playhead while playing.
  useEffect(() => {
    const loop = () => {
      if (audioRef.current) setCurrent(audioRef.current.currentTime);
      rafRef.current = requestAnimationFrame(loop);
    };
    if (playing) rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const n = samples.length;
    const centerY = HEIGHT / 2;
    const half = HEIGHT / 2 - EDGE;
    const ampAt = (x: number) => {
      if (n === 0) return 0;
      const i = Math.min(n - 1, Math.floor((x / width) * n));
      return Math.max(0, Math.min(1, samples[i] ?? 0));
    };

    const drawBars = (color: string) => {
      ctx.fillStyle = color;
      for (let x = 0; x < width; x += BAR_STEP) {
        const h = Math.max(1, ampAt(x) * half);
        ctx.fillRect(x, centerY - h, BAR_WIDTH, h * 2);
      }
    };

    // Unplayed shape in grey, then the played portion re-drawn in accent.
    drawBars("rgba(150, 150, 163, 0.5)");
    const playX = duration > 0 ? Math.min(1, current / duration) * width : 0;
    if (playX > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, playX, HEIGHT);
      ctx.clip();
      drawBars("rgba(139, 92, 246, 0.95)");
      ctx.restore();
    }
  }, [width, samples, current, duration]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  };

  const scrub = (e: React.MouseEvent) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, e.clientX - rect.left));
    a.currentTime = (x / width) * duration;
    setCurrent(a.currentTime);
  };

  return (
    <div className="moment-player">
      <audio
        ref={audioRef}
        src={src}
        crossOrigin="use-credentials"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
      />
      <Button
        variant="outline"
        size="sm"
        className="moment-play"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </Button>
      <div ref={wrapRef} className="moment-wave">
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: HEIGHT,
            display: "block",
            cursor: "pointer",
          }}
          onClick={scrub}
        />
      </div>
      <span className="muted small tabular moment-time">
        {fmtTime(current)} / {fmtTime(duration)}
      </span>
    </div>
  );
}
