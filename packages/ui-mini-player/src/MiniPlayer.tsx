// MiniPlayer.tsx — the bar at the bottom of an app: what is playing, how far in, and a way to
// stop looking at it. It holds NO transport of its own — every number is a prop and every
// button is a callback, because the two apps mounting it play very different things. It also
// fills the system's media session, so a phone's lock screen and headset drive the same callbacks.
// See ../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import type { LucideIcon } from "@frediverse/ui/icons";
import { Pause, Play, X } from "@frediverse/ui/icons";
import type { ReactNode } from "react";
import { useMediaSession } from "./mediaSession";

/** mm:ss — one clock, so two readings of one transport never disagree by a rounding. */
export function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Every string on the bar, since the two hosts translate through different catalogues. */
export interface MiniPlayerLabels {
  /** The section's accessible name — what this bar IS, read before anything in it. */
  region: string;
  play: string;
  pause: string;
  /** The scrubber's accessible name. */
  position: string;
  close: string;
}

export function MiniPlayer({
  icon: Icon,
  title,
  artist,
  album,
  meta,
  status,
  playing,
  position,
  duration,
  labels,
  onToggle,
  onSeek,
  onClose,
  onNext,
  children,
}: {
  /** The glyph before the title — a record, a headphone: what KIND of thing this is. */
  icon: LucideIcon;
  title: string;
  /** Plain text for the system's media controls, which cannot show `meta`; the bar does not draw them. */
  artist?: string;
  album?: string;
  /** Beside the title: the artist, the album, a version badge — whatever the host has. */
  meta?: ReactNode;
  /** The end of the title line, where a failure or "ended" goes; the host words both. */
  status?: ReactNode;
  playing: boolean;
  /** Seconds in, and the length — 0 until something knows it, which disables the scrubber. */
  position: number;
  duration: number;
  labels: MiniPlayerLabels;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  /** The system's skip button; the bar draws none, the host's queue button being its own. */
  onNext?: () => void;
  /** Controls of the host's own, right of the transport and left of the close. */
  children?: ReactNode;
}) {
  useMediaSession({
    title,
    artist,
    album,
    playing,
    position,
    duration,
    onToggle,
    onSeek,
    onClose,
    onNext,
  });
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <section
      aria-label={labels.region}
      className="relative flex shrink-0 items-center gap-3 border-t bg-card px-3 py-2"
    >
      <Button
        size="icon"
        variant="secondary"
        className="shrink-0"
        onClick={onToggle}
        aria-label={playing ? labels.pause : labels.play}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <Icon className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
          <span className="min-w-0 truncate font-medium text-sm">{title}</span>
          {meta}
          {status}
        </div>

        <div className="mt-1 flex items-center gap-2">
          <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
            {clock(position)}
          </span>
          {/* A range and not a div: dragging, the keyboard and the accessible name come with it. */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(position, duration || 0)}
            disabled={!duration}
            onChange={(e) => onSeek(Number(e.currentTarget.value))}
            aria-label={labels.position}
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded bg-muted accent-foreground"
            style={{
              background: `linear-gradient(to right, hsl(var(--foreground)) ${pct}%, hsl(var(--muted)) ${pct}%)`,
            }}
          />
          <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {clock(duration)}
          </span>
        </div>
      </div>

      {children}

      {/* Top right, and the only thing that takes the bar away: what ENDS does not remove it. */}
      <Button
        size="icon"
        variant="ghost"
        onClick={onClose}
        aria-label={labels.close}
        className="absolute top-1 right-1 h-6 w-6"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </section>
  );
}
