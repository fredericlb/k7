// useCameraFit.ts — framing: the whole graph to the host, once and again only for a different
// graph, a subset of nodes for a host walking a chain, and the camera handed up to a host that
// borrows it. Each fit ANSWERS whether it could frame anything — docs/camera.md.

import type { GraphNode, LaidOutGraph } from "@studio/ui-chains/graph";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { type Cam, clampZoom, frameOriginX } from "./camera";
import type { DomChainsProps, FitToFn, FitToOpts } from "./domChainsProps";

export function useCameraFit({
  cam,
  fitAxis,
  fitKey,
  fitMaxZoom,
  fitPad,
  fitted,
  graph,
  hostRef,
  hostSize,
  onCamReady,
  paintRef,
  place,
  userMoved,
}: {
  cam: RefObject<Cam>;
  fitAxis: NonNullable<DomChainsProps["fitAxis"]>;
  fitKey: DomChainsProps["fitKey"];
  fitMaxZoom: DomChainsProps["fitMaxZoom"];
  fitPad: number;
  fitted: RefObject<boolean>;
  graph: LaidOutGraph;
  hostRef: RefObject<HTMLDivElement | null>;
  hostSize: RefObject<{ w: number; h: number }>;
  onCamReady: DomChainsProps["onCamReady"];
  paintRef: RefObject<() => void>;
  place: (c: Cam) => void;
  userMoved: RefObject<boolean>;
}) {
  const fit = useRef<() => boolean>(() => false);
  fit.current = () => {
    const c = fitCam.current();
    if (!c) return false;
    // Framed, so from here the camera is worth remembering — `place` persists it.
    fitted.current = true;
    place(c);
    return true;
  };
  /** The camera that frames the whole graph, or null while there is no size to frame to. */
  const fitCam = useRef<() => Cam | null>(() => null);
  fitCam.current = () => {
    const host = hostRef.current;
    // isFinite, not truthy: an empty dagre layout reported -Infinity and still marked the view framed over nothing.
    if (
      !host ||
      !Number.isFinite(graph.width) ||
      !Number.isFinite(graph.height)
    )
      return null;
    // The BOX, not the extent: a pin may sit above the first track or left of it — docs/hosting.md.
    const gw = graph.width - graph.left;
    const gh = graph.height - graph.top;
    if (!gw || !gh) return null;
    const sw = host.clientWidth;
    const sh = host.clientHeight;
    if (!sw || !sh) return null;
    const pad = fitPad;
    // "height" frames the HEIGHT and lets the width run off the side, which is pannable — docs/camera.md.
    const k = clampZoom(
      Math.min(
        fitMaxZoom ?? Number.POSITIVE_INFINITY,
        fitAxis === "height"
          ? (sh / gh) * pad
          : Math.min((sw / gw) * pad, (sh / gh) * pad),
      ),
    );
    return {
      k,
      // Height-fitted content overflows, so it is pinned LEFT and each offset carries the box's corner.
      x:
        (fitAxis === "height" && gw * k > sw ? 0 : (sw - gw * k) / 2) -
        graph.left * k,
      y: (sh - gh * k) / 2 - graph.top * k,
    };
  };
  // Frame once, and again only when `fitKey` says this is a different graph. See docs/chainsGraph.md.
  const lastFitKey = useRef(fitKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  useLayoutEffect(() => {
    if (fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey;
      fitted.current = false;
    }
    if (!fitted.current) fitted.current = fit.current();
  }, [graph, fitKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Only until the first successful fit: the host starts at zero size, but later resizes must not re-frame.
    const ro = new ResizeObserver(([entry]) => {
      // The cable canvas is sized from here: not being in the flow, nothing else would tell it.
      const box = entry?.contentRect;
      if (box) hostSize.current = { w: box.width, h: box.height };
      paintRef.current();
      // Keep re-framing while the camera is still ours — the host settles for a while after the first fit.
      if (userMoved.current) return;
      if (fit.current()) fitted.current = true;
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // --- fitTo: frame a subset of nodes (chain selection from the sidebar) ---------
  const fitTo = useRef<FitToFn>(() => false);
  fitTo.current = (nodes: GraphNode[], opts: FitToOpts = {}) => {
    const { panOnly, axis = "both", zoom = 1 } = opts;
    const host = hostRef.current;
    if (!host || !nodes.length) return false;
    const sw = host.clientWidth;
    const sh = host.clientHeight;
    if (!sw || !sh) return false;
    // Framing a chain the user picked is their choice too — AFTER the size checks, so a no-op claims nothing.
    userMoved.current = true;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    const bw = maxX - minX;
    const bh = maxY - minY;
    const pad = 0.9;
    const k = clampZoom(
      (axis === "height"
        ? (sh / bh) * pad
        : Math.min((sw / bw) * pad, (sh / bh) * pad)) * zoom,
    );
    if (panOnly) {
      // Keep the zoom from the chain fit; only adjust translation to center the target.
      const cur = cam.current;
      place({
        k: cur.k,
        x: sw / 2 - (panOnly.x + panOnly.w / 2) * cur.k,
        y: sh / 2 - (panOnly.y + panOnly.h / 2) * cur.k,
      });
    } else {
      // Centred, EXCEPT a row that does not fit across — see `frameOriginX`, docs/camera.md.
      const spills = axis === "height" && bw * k > sw;
      const originX = frameOriginX(sw, bw * k, pad, spills);
      place({
        k,
        x: originX - minX * k,
        y: (sh - bh * k) / 2 - minY * k,
      });
    }
    return true;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  useEffect(() => {
    // One options object forwarded whole, because it cannot be half-forwarded by accident.
    onCamReady?.({
      fitTo: (nodes, opts) => fitTo.current(nodes, opts),
      get: () => ({ ...cam.current }),
      // Placed outright, no glide: putting a camera BACK is not a gesture to animate.
      set: (c) => {
        userMoved.current = true;
        place(c);
      },
    });
  }, [onCamReady]);
  return { fit, fitCam };
}
