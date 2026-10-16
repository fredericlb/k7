// panZoom.ts — navigation for the media panes, which scale to FIT by default (so there is
// nothing to scroll until you zoom). useHZoom scales horizontally, anchored so the point under
// the cursor stays put — by a mouse WHEEL, by trackpad pinch, by Cmd/Ctrl+wheel and by two
// fingers, but not by a trackpad slide, which stays the pan (isZoomWheel + isMouseWheel);
// usePanScroll pans on a MIDDLE-mouse drag — not Space-drag, because Space is the transport
// toggle in every app that mounts these.
// Unit-free on purpose: the caller multiplies its own lane width, in beats or in seconds.

import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** A wheel event that zooms whatever the DEVICE is — a pinch, or the modifier; see docs/panZoom.md. */
export const isZoomWheel = (e: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean => e.ctrlKey || e.metaKey;

/** Below this, a pixel-mode delta is a finger rather than a detent. A notch is ~100 (Chrome). */
const MOUSE_NOTCH_MIN = 40;

/** A mouse WHEEL rather than a surface, from THREE signals and wrong in one direction only — docs/panZoom.md. */
export function isMouseWheel(e: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  wheelDeltaY?: number;
}): boolean {
  if (e.deltaMode !== 0) return true;
  const legacy = e.wheelDeltaY;
  if (typeof legacy === "number" && legacy !== 0)
    return Math.abs(legacy) % 120 === 0;
  if (e.deltaX !== 0) return false;
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= MOUSE_NOTCH_MIN;
}

/** What one wheel event MEANS, as the whole rule in one testable place — order matters; docs/panZoom.md. */
export function wheelZooms(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  wheelDeltaY?: number;
}): boolean {
  if (isZoomWheel(e)) return true;
  if (e.shiftKey) return false;
  return isMouseWheel(e);
}

/** One wheel notch's worth of zoom. A whole step, because a notch is a discrete decision. */
const WHEEL_STEP = 1.15;

/** How much one wheel event zooms, a pinch being unable to share the notch's answer — docs/panZoom.md. */
export function wheelFactor(delta: number, pinch: boolean): number {
  if (!pinch) return delta < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
  return Math.exp(-clamp(delta, -50, 50) * 0.01);
}

/** The widest a scaled lane may become: half the browser's ~33.5M px layout limit — docs/panZoom.md. */
export const MAX_LANE_PX = 16_000_000;

/** How far a pane of `width` px may zoom before it meets that — DERIVED, not chosen; docs/panZoom.md. */
export const zoomCeiling = (width: number): number =>
  width > 0 ? Math.max(1, MAX_LANE_PX / width) : 32;

/** Horizontal zoom for a scroll container: 1 IS fit, `gutter` the non-scaling inset — docs/panZoom.md. */
export function useHZoom(
  ref: RefObject<HTMLElement | null>,
  opts: { gutter?: number; min?: number; max?: number } = {},
  // Values that gate the container's existence — a pane that renders "loading…" mounts its scroller only later.
  deps: unknown[] = [],
) {
  const { gutter = 0, min = 1, max } = opts;
  const [zoom, setZoom] = useState(1);
  // The ceiling from the PANE, remeasured on resize: a narrower window can only zoom further.
  const [paneW, setPaneW] = useState(0);
  const ceiling = max ?? zoomCeiling(Math.max(0, paneW - gutter));
  const zoomRef = useRef(zoom);
  // The scrollLeft to apply AFTER the width change renders: computed on the old width, correct on the new.
  const pendingLeft = useRef<number | null>(null);

  useLayoutEffect(() => {
    zoomRef.current = zoom;
    const el = ref.current;
    if (el && pendingLeft.current != null) {
      el.scrollLeft = pendingLeft.current;
      pendingLeft.current = null;
    }
  }, [zoom, ref]);

  // Its own observer rather than a prop: a caller measuring again is a second answer to one question.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setPaneW(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);

  /** Zoom to `next`, keeping what is under `clientX` fixed — ONE implementation, both gestures; docs/panZoom.md. */
  const zoomAt = useCallback(
    (next: number, clientX: number) => {
      const el = ref.current;
      const cur = zoomRef.current;
      if (!el || next === cur) return;
      // The gutter does not scale, so it is subtracted and re-added around the ratio.
      const offsetX = clientX - el.getBoundingClientRect().left;
      const laneX = el.scrollLeft + offsetX - gutter;
      pendingLeft.current = gutter + laneX * (next / cur) - offsetX;
      setZoom(next);
    },
    [ref, gutter],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // A trackpad SLIDE is handed back to the browser, whose native scroll is the pan.
      if (!wheelZooms(e)) return;
      // preventDefault stops the page moving AND the browser zooming it on the same gesture.
      e.preventDefault();
      const cur = zoomRef.current;
      // Favour the dominant axis: Ctrl held on a horizontal wheel is still someone asking to zoom.
      const delta =
        Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      // `e.ctrlKey` and not `isZoomWheel(e)`: only a ctrl-wheel is a pinch — see docs/panZoom.md.
      const next = clamp(cur * wheelFactor(delta, e.ctrlKey), min, ceiling);
      if (next === cur) return;
      zoomAt(next, e.clientX);
    };
    // Passive:false so preventDefault can stop the browser's page zoom on the pinch.
    el.addEventListener("wheel", onWheel, { passive: false });

    /** Two fingers on a touchscreen: TOUCH events, measured from the gesture's start — docs/panZoom.md. */
    let pinch: { dist: number; zoom: number } | null = null;
    const spread = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const centre = (t: TouchList) => (t[0].clientX + t[1].clientX) / 2;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2)
        pinch = { dist: spread(e.touches), zoom: zoomRef.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = spread(e.touches);
      if (d <= 0) return;
      zoomAt(
        clamp(pinch.zoom * (d / pinch.dist), min, ceiling),
        centre(e.touches),
      );
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    // Panning stays the browser's and the pinch is ours; set HERE, not in each caller's stylesheet.
    const hadTouchAction = el.style.touchAction;
    el.style.touchAction = "pan-x pan-y";

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.style.touchAction = hadTouchAction;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, min, ceiling, zoomAt, ...deps]);

  return [zoom, setZoom, zoomAt] as const;
}

/** Drag-to-pan with the MIDDLE button, on whichever axis overflows — see docs/panZoom.md. */
export function usePanScroll(
  ref: RefObject<HTMLElement | null>,
  // See useHZoom's `deps` — re-bind once a late-mounting container exists.
  deps: unknown[] = [],
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let panning = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMove = (e: PointerEvent) => {
      if (!panning) return;
      el.scrollLeft = startLeft - (e.clientX - startX);
      el.scrollTop = startTop - (e.clientY - startY);
    };
    const stop = () => {
      if (!panning) return;
      panning = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      el.style.cursor = "";
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 1) return; // middle button only
      // Take the gesture: no autoscroll, and no child handler (the roll's note-draw) claiming the press first.
      e.preventDefault();
      e.stopPropagation();
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
      el.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
    };
    // The middle-click autoscroll puck is a mousedown default — cancel it there too.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    // Capture phase: a bubble listener loses to a child's stopPropagation and to Firefox's autoscroll.
    el.addEventListener("pointerdown", onPointerDown, { capture: true });
    el.addEventListener("mousedown", onMouseDown, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("mousedown", onMouseDown, { capture: true });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      el.style.cursor = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
}
