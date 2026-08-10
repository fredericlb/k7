// panZoom.ts — navigation for the media panes, which scale to FIT by default (so there is
// nothing to scroll until you zoom). useHZoom scales horizontally, anchored so the point under
// the cursor stays put — by trackpad PINCH, by Cmd/Ctrl+wheel and by two fingers, but NOT by a
// plain wheel, which is the pan (see isZoomWheel); usePanScroll pans on a MIDDLE-mouse drag —
// not Space-drag, because Space is the transport toggle in every app that mounts these.
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

/**
 * Which gesture a wheel event IS: a zoom, or a pan.
 *
 * On a Mac trackpad — and on a Windows precision touchpad — a PINCH arrives as a wheel event
 * with `ctrlKey` set, synthesised by the browser; two fingers sliding arrive as a plain wheel.
 * There is no other signal, and it is why a plain wheel no longer zooms here: a trackpad has no
 * way to say "scroll" other than the plain wheel, so keeping zoom on it made every attempt to
 * pan zoom instead. `metaKey` joins it because Cmd+scroll is the same intention on a Mac mouse.
 *
 * The chains graph draws the same line, in its own camera (`@studio/ui-chains-react`): a pane
 * here scrolls and that one translates, so the rule is shared but not the code.
 */
const isZoomWheel = (e: WheelEvent): boolean => e.ctrlKey || e.metaKey;

/** One wheel notch's worth of zoom. A whole step, because a notch is a discrete decision. */
const WHEEL_STEP = 1.15;

/**
 * How much one wheel event zooms — and why a pinch cannot share the notch's answer.
 *
 * A mouse wheel arrives as ONE event per detent, with a large delta nobody reads the size of, so
 * a fixed step per event is exactly right. A trackpad PINCH arrives as Ctrl+wheel: a stream of
 * small continuous deltas, dozens a second. Given the notch's fixed step that stream multiplied
 * 1.15 per event and slammed into the zoom limit before the fingers had finished moving — which
 * is how "pinch does not work" is really spelled. Scaled BY the delta it tracks the fingers.
 *
 * The delta is clamped first: a browser that reports a pinch in hundreds rather than in units
 * would otherwise jump a decade in one event.
 *
 * The graph keeps its own (`@studio/ui-chains/zoomGesture`) because its NOTCH branch differs —
 * it scales by the delta where this one takes a step — and an arrangement package importing the
 * graph's would be the wrong way round. Both are tested; neither can drift in silence.
 */
export function wheelFactor(delta: number, pinch: boolean): number {
  if (!pinch) return delta < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
  return Math.exp(-clamp(delta, -50, 50) * 0.01);
}

/**
 * Horizontal zoom for a scroll container, driven by the mouse wheel. Returns the current
 * factor (1 = fit, grows to `max`) and a setter; the caller multiplies its lane width by
 * it. `gutter` is the fixed, non-scaling left inset (a track-name / note-name column) so
 * the anchor maths lands on the right beat; pass 0 for a gutterless pane.
 */
export function useHZoom(
  ref: RefObject<HTMLElement | null>,
  opts: { gutter?: number; min?: number; max?: number } = {},
  // Values that gate the container's existence — a pane that renders "loading…" mounts its scroller only later.
  deps: unknown[] = [],
) {
  const { gutter = 0, min = 1, max = 32 } = opts;
  const [zoom, setZoom] = useState(1);
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

  /**
   * Zoom to `next`, keeping whatever is under `clientX` where it is.
   *
   * Exposed because the wheel is not the only gesture that zooms: l8's ruler zooms on a
   * vertical drag, and had copied this arithmetic — the same line, descended from the same
   * commit — WITHOUT the deferral above. Applied straight away, the new scrollLeft is clamped
   * by the old scrollWidth, so an anchored zoom drifts. One implementation, both gestures.
   */
  const zoomAt = useCallback(
    (next: number, clientX: number) => {
      const el = ref.current;
      const cur = zoomRef.current;
      if (!el || next === cur) return;
      // Keep the content under the cursor fixed: scale its x by the zoom ratio and offset the
      // scroll. The gutter, which doesn't scale, is subtracted and re-added around that.
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
      // Only a pinch zooms. Two fingers sliding are handed BACK to the browser, whose native
      // scroll is the pan — with the momentum, the axis locking and the rubber-banding a
      // hand-rolled scrollLeft would have to counterfeit, and on both axes at once.
      if (!isZoomWheel(e)) return;
      // preventDefault stops the page moving, and the browser zooming the whole PAGE on the
      // same gesture — its own Ctrl+wheel zoom is exactly the gesture we just claimed.
      e.preventDefault();
      const cur = zoomRef.current;
      // Favour the dominant axis: a pinch is deltaY, but Ctrl held on a horizontal wheel is
      // still someone asking to zoom.
      const delta =
        Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      // `e.ctrlKey` and not `isZoomWheel(e)`: the guard above says WHETHER to zoom, this says
      // how much, and the two disagree on purpose. A ctrl-wheel is a trackpad pinch — a stream
      // of small deltas, scaled continuously — while Cmd+wheel is a Mac mouse, one notch per
      // detent. Both reach here; only the first is a pinch.
      const next = clamp(cur * wheelFactor(delta, e.ctrlKey), min, max);
      if (next === cur) return;
      // Keep the content under the cursor fixed: scale its x by the zoom ratio and offset the scroll. The gutter,
      // which doesn't scale, is subtracted and re-added around that.
      zoomAt(next, e.clientX);
    };
    // Passive:false so preventDefault can stop the browser's page zoom on the pinch. A plain
    // wheel returns before that and scrolls as it always would.
    el.addEventListener("wheel", onWheel, { passive: false });

    /**
     * Two fingers on a touchscreen, where there is no wheel at all.
     *
     * Touch events rather than pointer events, deliberately: this container SCROLLS, and the
     * browser claims a pointer the moment it decides a drag is a scroll — a pinch woven into
     * the pointer flow dies to a `pointercancel` half-way through. A non-passive `touchmove`
     * that preventDefaults for the length of the gesture is what holds the browser off.
     *
     * Measured against the zoom the gesture STARTED from, not frame to frame: a ratio of ratios
     * accumulates rounding, and pinching out then back in would not return where it began.
     */
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
      zoomAt(clamp(pinch.zoom * (d / pinch.dist), min, max), centre(e.touches));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    // Panning stays the browser's — it scrolls this container far better than we would — but
    // the pinch is ours, and `pan-x pan-y` is the value that says exactly that. Set here rather
    // than left to each caller's stylesheet: a surface that mounts this hook and forgets the
    // rule gets a gesture the browser silently swallows, with nothing on screen to explain it.
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
  }, [ref, min, max, zoomAt, ...deps]);

  return [zoom, setZoom, zoomAt] as const;
}

/**
 * Drag-to-pan a scroll container with the MIDDLE mouse button. Panning moves the view
 * under the cursor — dragging right reveals content to the left — on whichever axis
 * actually overflows, so a fit-width lane can still be panned vertically and a zoomed one
 * horizontally. (Space is left to the transport toggle, so it is not a pan modifier.)
 */
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

    // Capture phase: a bubble listener never fires if a child stops propagation, and loses the autoscroll race on
    // Firefox. Non-middle buttons return early WITHOUT stopping the event, so child clicks still work.
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
