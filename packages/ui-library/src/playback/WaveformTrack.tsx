// WaveformTrack.tsx — the bar's position row drawn as the song's waveform: the clocks either side,
// and a strip that seeks on click or on the release of a drag, like the scrubber it replaces.
// Hovering it PEEKS: a rule and the time under the pointer, and nothing moves until a click.
// The strip's canvas is @studio/ui-waveform's, under an overlay that takes every gesture.
// See ../../docs/miniPlayer.md, "The waveform in the bar".

import { clock } from "@studio/ui-mini-player";
import { Waveform } from "@studio/ui-waveform";
import { useEffect, useRef, useState } from "react";
import type { SongShape } from "../songWaveform";
import { bubbleShift, stepKey, timeAtX } from "./peek";

/** The strip's height with a mouse, and with a finger, which needs more to land on. */
const HEIGHT = 28;
const TOUCH_HEIGHT = 36;

/** Whether the device has no hover, read once and followed, since the canvas height is a number. */
function useNoHover(): boolean {
  const query = "(hover: none)";
  const [none, setNone] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const on = () => setNone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return none;
}

export function WaveformTrack({
  shape,
  position,
  duration,
  label,
  onSeek,
}: {
  shape: SongShape;
  position: number;
  /** The transport's length, 0 until known; the clock falls back to the shape's. */
  duration: number;
  /** The strip's accessible name, the scrubber's. */
  label: string;
  onSeek: (seconds: number) => void;
}) {
  // The strip's own axis: the shape's seconds, so the rule lands on the picture it points at.
  const total = shape.duration;
  const height = useNoHover() ? TOUCH_HEIGHT : HEIGHT;
  // Where the pointer is (the peek), and where a drag or a held key would seek to on release.
  const [peek, setPeek] = useState<number | null>(null);
  const [pending, setPendingState] = useState<number | null>(null);
  // Mirrored in a ref, so a release in the same frame as its press still commits what it pressed.
  const pendingRef = useRef<number | null>(null);
  const setPending = (t: number | null) => {
    pendingRef.current = t;
    setPendingState(t);
  };
  const dragging = useRef(false);
  const shown = pending ?? position;

  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return timeAtX(e.clientX - r.left, r.width, total);
  };
  const commit = () => {
    const t = pendingRef.current;
    if (t === null) return;
    setPending(null);
    onSeek(t);
  };

  return (
    <>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
        {clock(shown)}
      </span>
      <div className="relative min-w-0 flex-1 [&_.waveform-wrap]:rounded [&_.waveform-wrap]:border-0">
        <Waveform
          envelope={shape.envelope}
          duration={total}
          currentTime={shown}
          height={height}
        />
        {/* Over the canvas and taking every gesture: a click or a drag seeks once, a hover only peeks. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${clock(shown)} / ${clock(total)}`}
          className="absolute inset-0 cursor-pointer touch-none rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = true;
            const t = at(e);
            setPeek(t);
            setPending(t);
          }}
          onPointerMove={(e) => {
            const t = at(e);
            setPeek(t);
            if (dragging.current) setPending(t);
          }}
          onPointerUp={(e) => {
            if (!dragging.current) return;
            dragging.current = false;
            commit();
            // A finger has no hover to keep the peek alive once it lifts.
            if (e.pointerType !== "mouse") setPeek(null);
          }}
          onPointerCancel={() => {
            dragging.current = false;
            setPending(null);
            setPeek(null);
          }}
          onPointerLeave={() => {
            if (!dragging.current) setPeek(null);
          }}
          onKeyDown={(e) => {
            const t = stepKey(e.key, pendingRef.current ?? position, total);
            if (t === null) return;
            e.preventDefault();
            setPending(t);
          }}
          onKeyUp={commit}
          onBlur={commit}
        >
          {peek !== null && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
              style={{ left: `${(peek / total) * 100}%` }}
            >
              <span
                className="absolute bottom-full mb-1 whitespace-nowrap rounded bg-popover px-1 py-0.5 font-mono text-[10px] text-popover-foreground tabular-nums shadow"
                style={{
                  transform: `translateX(-${bubbleShift(peek, total) * 100}%)`,
                }}
              >
                {clock(peek)}
              </span>
            </div>
          )}
        </div>
      </div>
      <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {clock(duration || total)}
      </span>
    </>
  );
}
