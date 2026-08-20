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

/**
 * A wheel event that zooms whatever the DEVICE is: a trackpad pinch, or the same intention
 * spelled with a modifier.
 *
 * On a Mac trackpad — and on a Windows precision touchpad — a PINCH arrives as a wheel event
 * with `ctrlKey` set, synthesised by the browser; two fingers sliding arrive as a plain wheel.
 * `metaKey` joins it because Cmd+scroll is the same intention on a Mac mouse.
 *
 * A plain wheel is answered by `isMouseWheel` below: on a mouse it zooms, on a surface it slides.
 *
 * The chains graph draws the same line, in its own camera (`@studio/ui-chains-react`): a pane
 * here scrolls and that one translates, so the rule is shared but not the code.
 */
const isZoomWheel = (e: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  e.ctrlKey || e.metaKey;

/** Below this, a pixel-mode delta is a finger rather than a detent. A notch is ~100 (Chrome). */
const MOUSE_NOTCH_MIN = 40;

/**
 * A mouse WHEEL rather than a surface — two fingers on a trackpad, a touchscreen's inertia.
 *
 * They arrive as the same event and mean opposite things here. A wheel is a detent, discrete, and
 * the natural thing for it to do over an arrangement is ZOOM — which is what this pane was asked
 * for. A trackpad slide is a hand pushing the view about, and zooming there is what made every
 * attempt to pan a trackpad zoom instead; that is why a plain wheel stopped zooming in the first
 * place. So the two are told apart rather than legislated over.
 *
 * Three signals, most reliable first:
 *
 * 1. `deltaMode` other than pixels — lines or pages. Only a real wheel is ever reported that
 *    way (Firefox does it for mice), so it settles the question on its own.
 * 2. `wheelDeltaY`, the legacy field Chrome and Safari still carry. A mouse reports it in
 *    multiples of 120 — the detent, from the Windows API that named it — while a trackpad
 *    reports three times its pixel delta, which lands on 120 only by accident. This is what
 *    separates a Mac trackpad from a Mac mouse, and nothing standard does.
 * 3. Failing both (Firefox in pixel mode), the shape of the delta: a notch is integral, has no
 *    horizontal component, and is LARGE, where a finger's is small and often fractional.
 *
 * Wrong in one direction only, by design: an unrecognised device is treated as a surface, so it
 * keeps the behaviour that was there before. A trackpad that zooms is a broken trackpad; a mouse
 * that pans is merely a mouse that does not zoom yet.
 *
 * The graph decided this before the arrangement did and holds the same three signals
 * (`@studio/ui-chains-react`'s `camera.ts`). Written twice because neither package may depend on
 * the other — recorded in `docs/inventaire.md`, and tested on both sides so it cannot drift in
 * silence.
 */
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

/**
 * What one wheel event over an arrangement MEANS: zoom it, or leave the scroll to the browser.
 *
 * The whole rule, in one place and testable — the hook that uses it is an effect on a DOM node,
 * which nothing in this repo can mount, so a condition written inline there could only be
 * verified by hand.
 *
 * Order matters, and each line answers a different question:
 *
 * 1. a pinch (or Cmd/Ctrl+wheel) zooms whatever the device — it is the one gesture the browser
 *    marks for us, and Ctrl+Shift+wheel is still a pinch with a finger resting on Shift;
 * 2. SHIFT is left alone, because every browser already reads it as "scroll sideways". It is
 *    the one scroll gesture a mouse keeps once the bare wheel has become the zoom;
 * 3. otherwise it is the device that decides — `isMouseWheel` above.
 */
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
 * The widest a scaled lane may become, in px.
 *
 * There is no such thing as an unlimited zoom, and this is where the limit actually lives: a
 * browser refuses to lay out an element past about 33.5 million pixels, and a lane that asked for
 * more would be silently clipped — `scrollWidth` would stop agreeing with the width the caller
 * computed, and the anchored zoom would drift a little further off with every notch.
 *
 * Half of it, so the margin is the browser's own rounding rather than a guess.
 */
export const MAX_LANE_PX = 16_000_000;

/**
 * How far a pane of `width` px may zoom before it meets that.
 *
 * Which is what replaced a flat `max: 32`. Thirty-two was a number, not a reason — and it is the
 * one people MET: past it the wheel simply stopped, with nothing on screen to say why. Derived,
 * the ceiling is about 13 000× on a laptop pane, which is one 64th of a beat filling the screen
 * on a five-minute song. Nobody meets that either; what they meet is the material.
 *
 * The tick layers had a ceiling of their own and it was the real one — a whole-song list saturates
 * at 64 nodes per beat. They window themselves to the pane now (`Ruler.tsx`'s `useVisibleBeats`),
 * which is what makes this number the only one left.
 */
export const zoomCeiling = (width: number): number =>
  width > 0 ? Math.max(1, MAX_LANE_PX / width) : 32;

/**
 * Horizontal zoom for a scroll container, driven by the mouse wheel. Returns the current
 * factor (1 = fit, grows to whatever the pane can be drawn at) and a setter; the caller
 * multiplies its lane width by it. `gutter` is the fixed, non-scaling left inset (a track-name /
 * note-name column) so the anchor maths lands on the right beat; pass 0 for a gutterless pane.
 *
 * `min` is 1 and stays 1, and that is not the same kind of bound as the ceiling was: 1 IS fit, so
 * below it the pane would draw the whole thing plus empty space. There is nothing further out to
 * see. `max` is the derived ceiling above unless a caller states one.
 */
export function useHZoom(
  ref: RefObject<HTMLElement | null>,
  opts: { gutter?: number; min?: number; max?: number } = {},
  // Values that gate the container's existence — a pane that renders "loading…" mounts its scroller only later.
  deps: unknown[] = [],
) {
  const { gutter = 0, min = 1, max } = opts;
  const [zoom, setZoom] = useState(1);
  // The ceiling, from the pane rather than from a constant — remeasured when the pane resizes,
  // because a window dragged narrower can only be zoomed further, not less.
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

  // The pane's own width, for the ceiling. Its own observer rather than a prop: the hook already
  // holds the element, and a caller measuring it again would be a second answer to one question.
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

  /**
   * Zoom to `next`, keeping whatever is under `clientX` where it is.
   *
   * Exposed because the wheel is not the only gesture that zooms: st0's ruler zooms on a
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
      // A wheel notch zooms, a pinch zooms, a trackpad SLIDE is handed back to the browser —
      // whose native scroll is the pan, with the momentum, the axis locking and the rubber-banding
      // a hand-rolled scrollLeft would have to counterfeit, on both axes at once. Which is what a
      // mouse gives up by zooming: the wheel no longer walks the lanes vertically, and its pan is
      // the middle-drag (usePanScroll) or Shift+wheel. The rule itself is `wheelZooms`, tested.
      if (!wheelZooms(e)) return;
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
      const next = clamp(cur * wheelFactor(delta, e.ctrlKey), min, ceiling);
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
  }, [ref, min, ceiling, zoomAt, ...deps]);

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
