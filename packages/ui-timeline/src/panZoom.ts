// panZoom.ts — navigation for the media panes, which scale to FIT by default (so there
// is nothing to scroll until you zoom). useHZoom scales horizontally, anchored so the
// point under the cursor stays put; usePanScroll pans on a MIDDLE-mouse drag — not
// Space-drag, because Space is the transport toggle in every app that mounts these.
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
      // The wheel zooms (a trackpad pinch arrives as Ctrl+wheel and folds in); preventDefault stops the page moving.
      e.preventDefault();
      const cur = zoomRef.current;
      // Favour the dominant axis so a horizontal-wheel / shift-wheel still zooms.
      const delta =
        Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      const next = clamp(cur * (delta < 0 ? 1.15 : 1 / 1.15), min, max);
      if (next === cur) return;
      // Keep the content under the cursor fixed: scale its x by the zoom ratio and offset the scroll. The gutter,
      // which doesn't scale, is subtracted and re-added around that.
      zoomAt(next, e.clientX);
    };
    // Passive:false so preventDefault can stop the browser's page zoom on Ctrl+wheel.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
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
