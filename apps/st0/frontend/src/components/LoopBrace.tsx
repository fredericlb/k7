// LoopBrace.tsx — an event's LOOP in a clip panel's ruler: the switch that turns it on, and the brace whose two
// ends drag to move its points. Unit-free: the roll hands it beats of the notes, the waveform seconds of the file,
// each with its own mapping to pixels. The drag is local until release, then ONE command. See docs/clipEditors.md.

import { Repeat } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { useRef, useState } from "react";
import { m } from "../paraglide/messages.js";

/** The header's switch; drawn only where there is an event to loop. */
export function LoopToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle?: (on: boolean) => void;
}) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? m["clip.loopOff"]() : m["clip.loopOn"]()}
      onClick={() => onToggle(!on)}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5",
        on
          ? "bg-violet-500/20 text-violet-300"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Repeat className="h-3.5 w-3.5" />
      {m["clip.loop"]()}
    </button>
  );
}

/** The width a handle offers the pointer, px — the brace's edges themselves are drawn thinner. */
const HANDLE_W = 8;

export function LoopBrace({
  from,
  to,
  toPx,
  fromPx,
  min,
  max,
  snap,
  onCommit,
}: {
  /** The loop's points, in the panel's own unit. */
  from: number;
  to: number;
  /** The unit → x in the ruler's box, and back. */
  toPx: (u: number) => number;
  fromPx: (x: number) => number;
  /** How far a point may go — the material, which the event can only narrow. */
  min: number;
  max: number;
  /** Rounds a dragged point to the panel's grid; Alt drags free. */
  snap?: (u: number) => number;
  onCommit: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const shown = drag ?? { from, to };
  const left = toPx(shown.from);
  const right = toPx(shown.to);

  const handle = (side: "from" | "to") => ({
    onPointerDown: (e: React.PointerEvent) => {
      // The ruler under the brace seeks on a click; a handle grabbed is not a seek.
      e.stopPropagation();
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from, to });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag || !box.current) return;
      const x = e.clientX - box.current.getBoundingClientRect().left;
      const raw = fromPx(x);
      const u = Math.min(
        max,
        Math.max(min, e.altKey || !snap ? raw : snap(raw)),
      );
      // A point stops short of the other one: a loop of nothing plays nothing.
      setDrag((d) => {
        if (!d) return d;
        const gap = (max - min) / 1e4;
        return side === "from"
          ? { ...d, from: Math.min(u, d.to - gap) }
          : { ...d, to: Math.max(u, d.from + gap) };
      });
    },
    onPointerUp: () => {
      if (
        drag &&
        (Math.abs(drag.from - from) > 1e-9 || Math.abs(drag.to - to) > 1e-9)
      )
        onCommit(drag.from, drag.to);
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
  });

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute inset-y-0 border-violet-400 border-x-2 bg-violet-500/25"
        style={{ left, width: Math.max(2, right - left) }}
      />
      {(["from", "to"] as const).map((side) => (
        <div
          key={side}
          role="slider"
          aria-label={
            side === "from" ? m["clip.loopStart"]() : m["clip.loopEnd"]()
          }
          aria-valuenow={shown[side]}
          aria-valuemin={min}
          aria-valuemax={max}
          tabIndex={-1}
          className="pointer-events-auto absolute inset-y-0 cursor-ew-resize"
          style={{
            left: (side === "from" ? left : right) - HANDLE_W / 2,
            width: HANDLE_W,
          }}
          {...handle(side)}
        />
      ))}
    </div>
  );
}
