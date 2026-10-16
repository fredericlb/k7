// useNodeDrag.ts — a card dragged by its header and dropped: the pin gesture. The cables follow
// live, and the drop is held as an offset until the reload that carries it lands — docs/hosting.md.

import { jackRef } from "@studio/ui-chains/cables";
import type { GraphNode } from "@studio/ui-chains/graph";
import { usePointerFollow } from "@studio/ui-timeline/drag";
import { type RefObject, useCallback, useRef } from "react";
import type { Cam } from "./camera";
import type { ChainsCallbacks } from "./domChainsProps";
import type { Ghost } from "./nodeMotion";

export function useNodeDrag({
  cam,
  cb,
  drawn,
  paintRef,
  rebuildCables,
  suppressClick,
}: {
  cam: RefObject<Cam>;
  cb: RefObject<ChainsCallbacks>;
  drawn: RefObject<Map<string, Ghost<GraphNode>>>;
  paintRef: RefObject<() => void>;
  rebuildCables: RefObject<() => void>;
  suppressClick: RefObject<boolean>;
}) {
  const nodeDrag = useRef<{
    n: GraphNode;
    el: HTMLElement;
    sx: number;
    sy: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  // Dropped, written, waiting for the reload: offsets to honour and transforms to take off later.
  const droppedNodes = useRef(
    new Map<string, { dx: number; dy: number; el: HTMLElement }>(),
  );

  // One pointer per drag, abandoned on a cancel or an unmount — @studio/ui-timeline/drag.
  const follow = usePointerFollow();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const beginNodeDrag = useCallback(
    (n: GraphNode, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // The same press must not also arm a pan — the reason every header control stops it too.
      e.stopPropagation();
      const el = (e.currentTarget as HTMLElement).closest(
        "[data-node-id]",
      ) as HTMLElement | null;
      if (!el) return;
      // A press STARTS a gesture, so it clears the flag itself, exactly as a jack does.
      suppressClick.current = false;
      nodeDrag.current = {
        n,
        el,
        sx: e.clientX,
        sy: e.clientY,
        dx: 0,
        dy: 0,
        moved: false,
      };
      const onMove = (ev: PointerEvent) => {
        const d = nodeDrag.current;
        if (!d) return;
        const k = Math.max(cam.current.k, 0.01);
        d.dx = (ev.clientX - d.sx) / k;
        d.dy = (ev.clientY - d.sy) / k;
        if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 3)
          d.moved = true;
        d.el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
        // The cables follow live, through the same path a node MOTION takes, springs included.
        rebuildCables.current();
        paintRef.current();
      };
      const onUp = () => {
        const d = nodeDrag.current;
        nodeDrag.current = null;
        if (!d) return;
        if (!d.moved) {
          // A press that never travelled is a click, and the click is the node's own.
          d.el.style.transform = "";
          return;
        }
        // It travelled, so the click that follows is the drag's tail rather than a tap: swallow it.
        suppressClick.current = true;
        // Wherever it was let go, including ABOVE the first track or left of it — docs/hosting.md.
        const x = Math.round(d.n.x + d.dx);
        const y = Math.round(d.n.y + d.dy);
        droppedNodes.current.set(d.n.id, {
          dx: x - d.n.x,
          dy: y - d.n.y,
          el: d.el,
        });
        // Pre-seed the drawn map with the drop, so the layout landing the write plans NO slide.
        drawn.current.set(d.n.id, { node: d.n, x, y });
        rebuildCables.current();
        paintRef.current();
        cb.current.onMoveNode?.(jackRef(d.n), x, y);
      };
      // A cancel, or the graph going away mid-drag, puts the card back and moves nothing.
      const onCancel = () => {
        const d = nodeDrag.current;
        nodeDrag.current = null;
        if (!d) return;
        d.el.style.transform = "";
        rebuildCables.current();
        paintRef.current();
      };
      follow(e, { move: onMove, end: onUp, cancel: onCancel });
    },
    [follow],
  );
  return { beginNodeDrag, droppedNodes, nodeDrag };
}
