// MiniPlayer.tsx — the bar at the bottom of an app: what is playing, how far in, and a way to
// stop looking at it. It holds NO transport of its own — every number is a prop and every
// button is a callback, because the screens mounting it play very different things. It also
// fills the system's media session, so a phone's lock screen and headset drive the same callbacks.
// Inside a `MiniPlayerDock` it is drawn in the dock's outlet, not where it is mounted (dock.tsx).
// See ../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import type { LucideIcon } from "@frediverse/ui/icons";
import { X } from "@frediverse/ui/icons";
import { formatClock } from "@studio/ui-timeline/ticks";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDockSlot } from "./dock";
import { useMediaSession } from "./mediaSession";
import { PlayButton } from "./PlayButton";
import { useScrub } from "./useScrub";

/** mm:ss — one clock, so two readings of one transport never disagree by a rounding. */
export function clock(sec: number): string {
  return formatClock(Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0);
}

/** Every string on the bar, since the hosts translate through different catalogues. */
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
  playMenu,
  onSeek,
  onClose,
  onNext,
  lead,
  trail,
  end,
  transport,
  track,
  mediaSession = true,
  standby = false,
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
  /** The play button's menu, opened by a right-click or a long press: the host's items. */
  playMenu?: ReactNode;
  onSeek: (seconds: number) => void;
  /** Absent, the bar has no close: a host whose transport is always there. */
  onClose?: () => void;
  /** The system's skip button; the bar draws none, the host's queue button being its own. */
  onNext?: () => void;
  /** At the bar's left edge, outside its centred part: a host's name for what it is, and its way out. */
  lead?: ReactNode;
  /** At the bar's right edge, outside its centred part and before the close: where a host's way elsewhere goes. */
  trail?: ReactNode;
  /** After `trail`, set off by a rule: a second right slot, for what the host's way elsewhere is not. */
  end?: ReactNode;
  /** In place of the play/pause button, for a host whose transport is more than one. */
  transport?: ReactNode;
  /** In place of the clocks and the scrubber — null for no position row at all. */
  track?: ReactNode;
  /** False for a host whose sound is not this page's, so the system's controls are left to one that is. */
  mediaSession?: boolean;
  /** A dock's bar for while nothing plays: drawn only while no other bar is docked. */
  standby?: boolean;
  /** Controls of the host's own, right of the transport and left of the close. */
  children?: ReactNode;
}) {
  const dock = useDockSlot(standby);
  const leadShown = lead ?? (dock.docked ? dock.lead : undefined);
  const endShown = end ?? (dock.docked ? dock.end : undefined);
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
    enabled: mediaSession,
  });
  // While dragging, the bar shows where the thumb is and seeks once, on release.
  const scrub = useScrub(onSeek);
  const shown = scrub.value ?? position;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;
  // A host whose name stands in `lead` passes an empty title, and the line goes with it.
  const titled = !!title || !!meta || !!status;
  // A docked bar is drawn in the outlet or not at all, never where it was mounted.
  if (dock.docked && (dock.hidden || !dock.target)) return null;
  const bar = (
    <section
      aria-label={labels.region}
      className={`relative flex shrink-0 items-center gap-3 border-t bg-card px-3 py-2${onClose ? ` [@media(hover:none)]:pr-12${trail || endShown ? " pr-9" : ""}` : ""}`}
    >
      {leadShown && (
        <div className="flex min-w-0 max-w-[24rem] shrink items-center gap-1.5">
          {leadShown}
        </div>
      )}
      {/* Centred and capped: on a wide screen the transport, the title and the clocks stay together. */}
      <div className="mx-auto flex w-full min-w-0 max-w-[800px] items-center gap-3">
        {transport !== undefined ? (
          <div className="flex shrink-0 items-center gap-1">{transport}</div>
        ) : (
          <PlayButton
            playing={playing}
            onToggle={onToggle}
            playLabel={labels.play}
            pauseLabel={labels.pause}
            menu={playMenu}
          />
        )}

        <div className="min-w-0 flex-1">
          {titled && (
            <div className="mb-1 flex min-w-0 items-baseline gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
              <span className="min-w-0 truncate font-medium text-sm">
                {title}
              </span>
              {meta}
              {status}
            </div>
          )}

          {track !== undefined ? (
            <div className="flex min-w-0 items-center gap-2">{track}</div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                {clock(shown)}
              </span>
              {/* The track is drawn thin behind a taller range, so a finger finds it without the bar growing. */}
              <div className="relative flex h-5 min-w-0 flex-1 items-center [@media(hover:none)]:h-8">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 h-1 rounded"
                  style={{
                    // The design system's tokens are whole colours; the rest of the track is the muted text, faded.
                    background: `linear-gradient(to right, var(--color-foreground) ${pct}%, color-mix(in oklab, var(--color-muted-foreground) 35%, transparent) ${pct}%)`,
                  }}
                />
                {/* A range and not a div: dragging, the keyboard and the accessible name come with it. */}
                <input
                  ref={scrub.ref}
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={Math.min(shown, duration || 0)}
                  disabled={!duration}
                  onChange={(e) => scrub.preview(Number(e.currentTarget.value))}
                  onPointerDown={scrub.begin}
                  onKeyUp={scrub.commit}
                  onBlur={scrub.commit}
                  aria-label={labels.position}
                  className="relative h-full w-full min-w-0 cursor-pointer appearance-none bg-transparent accent-foreground"
                />
              </div>
              <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                {clock(duration)}
              </span>
            </div>
          )}
        </div>

        {children}
      </div>

      {trail && (
        <div className="flex shrink-0 items-center justify-end gap-1">
          {trail}
        </div>
      )}

      {endShown && (
        <div className="flex min-w-0 shrink items-center gap-1.5 border-l pl-3">
          {endShown}
        </div>
      )}

      {/* Top right, and the only thing that takes the bar away: what ENDS does not remove it. */}
      {onClose && (
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          aria-label={labels.close}
          className="absolute top-1 right-1 h-6 w-6 [@media(hover:none)]:top-1/2 [@media(hover:none)]:h-10 [@media(hover:none)]:w-10 [@media(hover:none)]:-translate-y-1/2"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </section>
  );
  return dock.docked && dock.target ? createPortal(bar, dock.target) : bar;
}
