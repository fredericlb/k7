// BottomPanel.tsx — the open/close movement of the panel under the page, the bottom twin of
// RightPanel.tsx. It PUSHES the page up rather than covering it, so what animates is its HEIGHT.
// The thing a reader would get wrong: the content is held at the panel's final height while it
// travels, so a graph or a roll inside does not re-fit itself on every frame of the movement;
// and the transition is OFF once open, since the divider drag writes the height per pointermove.

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** The travel, in step with `duration-200` below and with RightPanel's. */
const MS = 200;

type Phase = "closed" | "opening" | "open" | "closing";

export function BottomPanel({
  open,
  /** The height once open — a length in px or a percentage of the column, as `style.height` takes it. */
  height,
  panelRef,
  onResizeStart,
  children,
}: {
  open: boolean;
  height: number | string;
  panelRef: RefObject<HTMLDivElement | null>;
  onResizeStart: (e: React.PointerEvent) => void;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  // Whether the outer box is at its target rather than at 0; a frame behind `opening`, so there is a 0 to animate from.
  const [tall, setTall] = useState(open);
  // The content's height while travelling, measured once at each end of the movement.
  const [travel, setTravel] = useState(0);
  // What to draw on the way OUT: the caller has already stopped choosing a panel by then.
  const last = useRef<ReactNode>(null);
  if (open) last.current = children;

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (open) {
      if (phase === "open" || phase === "opening") return;
      setPhase("opening");
      setTall(false);
      return;
    }
    if (phase === "closed" || phase === "closing") return;
    setTravel(el?.offsetHeight ?? 0);
    setPhase("closing");
    setTall(false);
  }, [open, phase, panelRef]);

  // Mounted at 0 by now: measure the target against the column, then grow to it on the next frame.
  useLayoutEffect(() => {
    if (phase !== "opening" || tall) return;
    const column = panelRef.current?.parentElement?.clientHeight ?? 0;
    setTravel(
      typeof height === "number"
        ? height
        : height.endsWith("%")
          ? (column * Number.parseFloat(height)) / 100
          : column / 2,
    );
    const f = requestAnimationFrame(() => setTall(true));
    return () => cancelAnimationFrame(f);
  }, [phase, tall, height, panelRef]);

  useEffect(() => {
    // Counted from the moment the box starts moving, so `open` does not cut the last frames short.
    if (
      phase === "closed" ||
      phase === "open" ||
      (phase === "opening" && !tall)
    )
      return;
    const t = setTimeout(
      () => setPhase(phase === "opening" ? "open" : "closed"),
      MS,
    );
    return () => clearTimeout(t);
  }, [phase, tall]);

  if (phase === "closed") return null;
  const moving = phase !== "open";
  return (
    <>
      <div
        onPointerDown={onResizeStart}
        className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/60"
      />
      <div
        ref={panelRef}
        className={`relative min-h-0 shrink-0 overflow-hidden border-t border-border bg-background ${
          moving
            ? "transition-[height] duration-200 ease-out motion-reduce:transition-none"
            : ""
        }`}
        style={{ height: tall ? (phase === "opening" ? travel : height) : 0 }}
      >
        <div
          className="relative h-full"
          style={moving ? { height: travel } : undefined}
        >
          {open ? children : last.current}
        </div>
      </div>
    </>
  );
}
