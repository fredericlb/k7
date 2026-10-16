// useChainsCamera.ts — the camera's frame loop, the wheel and the pinch, and the flights a
// double-click or the minimap asks for. Bound once and writing only refs, so no gesture costs a
// render; the numbers themselves are camera.ts — docs/camera.md.

import type { GraphNode } from "@studio/ui-chains/graph";
import { pinchFactor, spreadOf } from "@studio/ui-chains/zoomGesture";
import { isMouseWheel, isZoomWheel } from "@studio/ui-timeline/panZoom";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
} from "react";
import {
  applyCam,
  approach,
  type Cam,
  clampZoom,
  flyStep,
  frameBox,
  type Lod,
  lodFor,
  sameLod,
  wheelFactor,
  wheelPixels,
  zoomAbout,
} from "./camera";
import type { Motion } from "./nodeMotion";

export function useChainsCamera({
  anchor,
  before,
  cam,
  fit,
  fixedRef,
  flight,
  flightHalf,
  goal,
  hostRef,
  hostSize,
  kick,
  lodRef,
  motionStep,
  motions,
  paintRef,
  pan,
  persistRef,
  placeRef,
  rowRef,
  setLod,
  setPanning,
  settleMotion,
  userMoved,
  worldRef,
}: {
  anchor: RefObject<{ px: number; py: number }>;
  before: RefObject<Cam | null>;
  cam: RefObject<Cam>;
  fit: RefObject<() => boolean>;
  fixedRef: RefObject<boolean>;
  flight: RefObject<Cam | null>;
  flightHalf: RefObject<number | undefined>;
  goal: RefObject<Cam>;
  hostRef: RefObject<HTMLDivElement | null>;
  hostSize: RefObject<{ w: number; h: number }>;
  kick: RefObject<() => void>;
  lodRef: RefObject<Lod>;
  motionStep: RefObject<(dt: number) => boolean>;
  motions: RefObject<Map<string, Motion>>;
  paintRef: RefObject<() => void>;
  pan: RefObject<{
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    moved: number;
  } | null>;
  persistRef: RefObject<() => void>;
  placeRef: RefObject<(c: Cam) => void>;
  rowRef: RefObject<boolean | undefined>;
  setLod: Dispatch<SetStateAction<Lod>>;
  setPanning: Dispatch<SetStateAction<boolean>>;
  settleMotion: RefObject<() => void>;
  userMoved: RefObject<boolean>;
  worldRef: RefObject<HTMLDivElement | null>;
}) {
  // The camera loop, the wheel and the pinch, bound once and writing only refs — docs/camera.md.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let last = 0;
    const step = (t: number) => {
      // Clamped: a backgrounded tab hands back one enormous dt, which would land the glide at once.
      const dt = last ? Math.min(100, t - last) : 16;
      last = t;
      const c = cam.current;
      const g = goal.current;
      let moving = pan.current != null;
      // The cards, before the camera: `motionStep` rebuilds the cable draws for this frame.
      if (motions.current.size) {
        const still = motionStep.current(dt);
        moving = moving || still;
        if (!still) settleMotion.current();
      }
      const fl = flight.current;
      if (fl) {
        const next = flyStep(
          c,
          fl,
          approach(dt, flightHalf.current),
          host.clientWidth,
          host.clientHeight,
        );
        Object.assign(c, next);
        Object.assign(g, next);
        if (next.k === fl.k && next.x === fl.x && next.y === fl.y)
          flight.current = null;
        else moving = true;
      }
      if (c.k !== g.k) {
        // Within a thousandth of the goal, land on it — an exponential never quite arrives.
        const near = Math.abs(g.k - c.k) <= c.k * 1e-3;
        const k = near ? g.k : c.k + (g.k - c.k) * approach(dt);
        Object.assign(c, zoomAbout(c, k, anchor.current.px, anchor.current.py));
        Object.assign(g, { x: c.x, y: c.y });
        moving = moving || !near;
      }
      applyCam(worldRef.current, c);
      paintRef.current(); // the canvas is outside `.dgx-world`, so the transform misses it
      const next = lodFor(c.k);
      if (!sameLod(next, lodRef.current)) {
        lodRef.current = next;
        setLod(next);
      }
      if (moving) raf = requestAnimationFrame(step);
      else {
        raf = 0;
        last = 0;
        persistRef.current(); // settled — this is the camera worth remembering
      }
    };
    kick.current = () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(step);
      }
    };
    // Non-passive: it must preventDefault, and a React onWheel would allocate an event per notch.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // A tab column longer than its card scrolls under the wheel, as a list does, instead of moving the camera.
      const col = (e.target as Element | null)?.closest?.(".dgx-tabs");
      if (
        col instanceof HTMLElement &&
        col.scrollHeight > col.clientHeight &&
        !e.ctrlKey
      ) {
        col.scrollTop += wheelPixels(e.deltaY, e.deltaMode, col.clientHeight);
        return;
      }
      if (fixedRef.current) return;
      flight.current = null;
      userMoved.current = true; // either way, the camera is theirs now — stop auto-framing
      if (rowRef.current) {
        // A ROW is read across: the wheel walks along it, whatever axis the device reports.
        const c = cam.current;
        const g = goal.current;
        g.k = c.k;
        c.x = g.x =
          g.x -
          wheelPixels(e.deltaX || e.deltaY, e.deltaMode, host.clientWidth);
      } else if (isZoomWheel(e) || isMouseWheel(e)) {
        const r = host.getBoundingClientRect();
        anchor.current = { px: e.clientX - r.left, py: e.clientY - r.top };
        // Multiplied onto the GOAL, and `e.ctrlKey` marks a PINCH with its own rate — docs/camera.md.
        goal.current.k = clampZoom(
          goal.current.k *
            wheelFactor(e.deltaY, e.deltaMode, host.clientHeight, e.ctrlKey),
        );
      } else {
        // Two fingers on a SURFACE: the camera moves WITH them, 1:1 and with no glide, in screen px.
        const c = cam.current;
        const g = goal.current;
        g.k = c.k; // a slide takes over from any zoom still in flight, as a pointer-down does
        c.x = g.x = g.x - wheelPixels(e.deltaX, e.deltaMode, host.clientWidth);
        c.y = g.y = g.y - wheelPixels(e.deltaY, e.deltaMode, host.clientHeight);
      }
      kick.current();
    };
    host.addEventListener("wheel", wheel, { passive: false });

    // Two fingers where there is no wheel at all — TOUCH events, and absolute, docs/camera.md.
    let pinch: { dist: number; k: number; x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || fixedRef.current) return;
      flight.current = null;
      pan.current = null; // a pinch is not a pan, whatever the first finger had started
      setPanning(false);
      pinch = { dist: spreadOf(e.touches[0], e.touches[1]), ...cam.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = spreadOf(e.touches[0], e.touches[1]);
      if (d <= 0) return;
      const r = host.getBoundingClientRect();
      const px = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const py = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      userMoved.current = true;
      const k = clampZoom(pinch.k * pinchFactor(pinch.dist, d));
      // From the gesture's OWN starting camera, which is what makes the whole pinch absolute.
      Object.assign(cam.current, zoomAbout(pinch, k, px, py));
      Object.assign(goal.current, cam.current);
      kick.current();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    host.addEventListener("touchstart", onTouchStart, { passive: false });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);

    return () => {
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // --- the double-click camera: onto a node, and back to where it was — docs/camera.md -----
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const flyTo = useCallback((to: Cam) => {
    userMoved.current = true; // a camera somebody asked for; no resize re-frames it away
    goal.current.k = cam.current.k; // a zoom still gliding gives way, as it does to a press
    flightHalf.current = undefined;
    flight.current = to;
    kick.current();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const zoomToNode = useCallback(
    (n: GraphNode) => {
      const host = hostRef.current;
      // A ROW is walked along rather than zoomed into — docs/camera.md.
      if (!host || rowRef.current || fixedRef.current) return;
      // The view before the FIRST node visited, however many are visited after it.
      before.current ??= { ...cam.current };
      flyTo(
        frameBox(
          { x: n.x, y: n.y, w: n.w, h: n.h },
          host.clientWidth,
          host.clientHeight,
        ),
      );
    },
    [flyTo],
  );
  // Only on the BARE canvas: a card, a badge, a socket or a cable is not empty space.
  const canvasDoubleClick = (e: React.MouseEvent) => {
    if (
      (e.target as Element).closest(
        ".dgx-node, .dgx-frame, .dgx-alts, .dgx-engine, .dgx-port, .dgx-hit, .dgx-ins-btn",
      )
    )
      return;
    const back = before.current;
    if (!back) return;
    before.current = null;
    flyTo(back);
  };

  // The minimap: a press puts the pane's centre there, and "Zoom fit" is the first frame again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const centerOn = useCallback((wx: number, wy: number) => {
    const { w, h } = hostSize.current;
    const k = cam.current.k;
    flight.current = null;
    userMoved.current = true;
    placeRef.current({ k, x: w / 2 - wx * k, y: h / 2 - wy * k });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const zoomFit = useCallback(() => {
    flight.current = null;
    before.current = null;
    // The camera is the graph's again: a resize re-frames it, as it did before anybody moved it.
    userMoved.current = false;
    fit.current();
  }, []);
  return { canvasDoubleClick, centerOn, zoomFit, zoomToNode };
}
