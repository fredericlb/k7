// WaveformFill.tsx — the bar's whole row right of the play button, drawn as the song's waveform:
// the title over its left end and the clocks over its right, neither taking a pointer, and a strip
// that seeks on click or on the release of a drag. Hovering it PEEKS: a rule and the time under the
// pointer, and nothing moves until a click. The canvas is @studio/ui-waveform's, under a gesture layer.
// See ../../docs/miniPlayer.md, "The waveform in the bar".

import { clock } from "@studio/ui-mini-player";
import { Waveform } from "@studio/ui-waveform";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { SongShape } from "../songWaveform";
import { bubbleShift, stepKey, timeAtX } from "./peek";

/** The strip's height with a mouse, and with a finger, which needs more to land on. */
const HEIGHT = 44;
const TOUCH_HEIGHT = 52;

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

/** Over the waveform and under nothing: legible on the bright strip, and transparent to the pointer. */
const OVERLAY =
  "pointer-events-none absolute opacity-50 top-1/2 flex max-w-[60%] -translate-y-1/2 items-center gap-2 rounded bg-card/75 px-1.5 py-0.5";

export function WaveformFill({
  shape,
  title,
  position,
  duration,
  label,
  onSeek,
}: {
  shape: SongShape;
  /** Over the strip's left end: the title, and whatever the host says after it. */
  title: ReactNode;
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

    // Important: the waveform's own stylesheet is unlayered, so it beats a plain utility.
  return (
    <div className="relative h-full min-w-0 [&_.waveform-wrap]:rounded! [&_.waveform-wrap]:border-0!">
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
      <div className={`${OVERLAY} left-1.5`}>{title}</div>
      <div
        className={`${OVERLAY} right-1.5 font-mono text-[11px] text-muted-foreground tabular-nums`}
      >
        {clock(shown)} / {clock(duration || total)}
      </div>
    </div>
  );
}
