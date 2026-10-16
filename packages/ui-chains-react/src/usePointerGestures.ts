// usePointerGestures.ts — the window's pointer listeners, bound once: the pan, the Shift+drag
// marquee, and the move and release of a widget drag. A gesture taken away — cancelled, focus
// lost, released outside — is undone and writes nothing — docs/camera.md, docs/widgets.md.

import { pairValue, widgetDenorm } from "@studio/ui-chains/graph";
import { linkedValue, nodesInBox } from "@studio/ui-chains/multiSelect";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Cam } from "./camera";
import type { OverrideStore } from "./chainsStores";
import type { ChainsCallbacks } from "./domChainsProps";
import type { useWidgetDrag } from "./useWidgetDrag";
import { targetKey } from "./widgetTarget";

type WidgetDrag = ReturnType<typeof useWidgetDrag>;

const DRAG_SLOP = 4; // px of movement before a press becomes a pan (so a pan never selects)
const DRAG_FINE = 0.25; // shift-held multiplier for a fine adjustment

export function usePointerGestures({
  cam,
  cb,
  commitParam,
  drag,
  fixedRef,
  flight,
  goal,
  hostRef,
  kick,
  nodesRef,
  rehearsalRef,
  rowRef,
  selRef,
  sendLive,
  setHovered,
  setMulti,
  setOverride,
  setPanning,
  userMoved,
}: {
  cam: RefObject<Cam>;
  cb: RefObject<ChainsCallbacks>;
  commitParam: WidgetDrag["commitParam"];
  drag: WidgetDrag["drag"];
  fixedRef: RefObject<boolean>;
  flight: RefObject<Cam | null>;
  goal: RefObject<Cam>;
  hostRef: RefObject<HTMLDivElement | null>;
  kick: RefObject<() => void>;
  nodesRef: WidgetDrag["nodesRef"];
  rehearsalRef: WidgetDrag["rehearsalRef"];
  rowRef: RefObject<boolean | undefined>;
  selRef: WidgetDrag["selRef"];
  sendLive: WidgetDrag["sendLive"];
  setHovered: Dispatch<SetStateAction<string | null>>;
  setMulti: WidgetDrag["setMulti"];
  setOverride: OverrideStore["set"];
  setPanning: Dispatch<SetStateAction<boolean>>;
  userMoved: RefObject<boolean>;
}) {
  // Global pointer handling — pan, widget drag, gesture settle. Bound once; a movement threshold gates selection.
  const pan = useRef<{
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    moved: number;
  } | null>(null);
  const suppressClick = useRef(false);
  // A Shift+drag over empty space: the rectangle, in HOST pixels, that selects what it touches on release.
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const marqueeRef = useRef(marquee);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  useEffect(() => {
    /** A gesture taken away — cancelled, focus lost, a release that happened outside: undone, and nothing written. */
    const cancel = () => {
      if (marqueeRef.current) {
        marqueeRef.current = null;
        setMarquee(null);
      }
      const d = drag.current;
      if (d) {
        drag.current = null;
        // The engine heard the drag live, so it is told the value back; the knob then shows the file's again.
        if (d.tgt.kind === "plugin" || d.tgt.kind === "offline") {
          sendLive(d.tgt, d.from);
          if (d.pair) sendLive(d.pair, pairValue(d.w, d.from));
          for (const l of d.linked) {
            const v = linkedValue(d.w, l.startT, d.startT, d.startT);
            sendLive(l.tgt, v);
            if (l.pair) sendLive(l.pair, pairValue(d.w, v));
          }
        }
        const keys = [
          d.key,
          d.pair && targetKey(d.pair),
          ...d.linked.flatMap((l) => [
            targetKey(l.tgt),
            l.pair && targetKey(l.pair),
          ]),
        ];
        setOverride((o) => {
          const next = { ...o };
          for (const k of keys) if (k) delete next[k];
          return next;
        });
      }
      if (pan.current) {
        pan.current = null;
        setPanning(false);
      }
    };
    const move = (e: PointerEvent) => {
      // A mouse with no button down while a gesture runs: its release happened where this window could not hear it.
      if (
        e.pointerType === "mouse" &&
        e.buttons === 0 &&
        (drag.current || marqueeRef.current || pan.current)
      )
        return cancel();
      const mq = marqueeRef.current;
      if (mq) {
        const r = hostRef.current?.getBoundingClientRect();
        marqueeRef.current = {
          ...mq,
          x1: e.clientX - (r?.left ?? 0),
          y1: e.clientY - (r?.top ?? 0),
        };
        setMarquee(marqueeRef.current);
        return;
      }
      const d = drag.current;
      if (d) {
        const dy = (d.startY - e.clientY) / d.travel;
        const t = d.startT + dy * (e.shiftKey ? DRAG_FINE : 1);
        const value = widgetDenorm(d.w, t);
        if (value === d.value) return;
        d.value = value;
        const dry = d.pair ? pairValue(d.w, value) : null;
        setOverride((o) => {
          const next = {
            ...o,
            [d.key]: value,
            ...(d.pair && dry !== null ? { [targetKey(d.pair)]: dry } : {}),
          };
          // The same TRAVEL, not the same value: each linked knob keeps its offset from the one in hand.
          for (const l of d.linked) {
            l.value = linkedValue(d.w, l.startT, d.startT, t);
            next[targetKey(l.tgt)] = l.value;
            if (l.pair) next[targetKey(l.pair)] = pairValue(d.w, l.value);
          }
          return next;
        });
        // Coalesce to one live send per frame; only a plugin param feeds live (a track knob persists on release).
        if (!d.sent && (d.tgt.kind === "plugin" || d.tgt.kind === "offline")) {
          d.sent = true;
          requestAnimationFrame(() => {
            const cur = drag.current;
            if (!cur) return;
            cur.sent = false;
            for (const t of [cur, ...cur.linked]) {
              sendLive(t.tgt, t.value);
              if (t.pair) sendLive(t.pair, pairValue(cur.w, t.value));
            }
          });
        }
        return;
      }
      const p = pan.current;
      if (!p) return;
      const nx = e.clientX - p.sx;
      const ny = e.clientY - p.sy;
      p.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (p.moved > DRAG_SLOP) {
        setPanning(true);
        setHovered(null);
        userMoved.current = true; // the camera is theirs now — stop auto-framing
        // Both axes and no glide, unless the graph is a ROW — docs/camera.md.
        cam.current.x = goal.current.x = p.cx + nx;
        if (!rowRef.current) cam.current.y = goal.current.y = p.cy + ny;
        kick.current();
      }
    };
    const up = () => {
      const mq = marqueeRef.current;
      if (mq) {
        marqueeRef.current = null;
        setMarquee(null);
        // Host pixels to world through the camera, both corners, then every card the box touches joins the selection.
        const c = cam.current;
        const caught = nodesInBox(nodesRef.current, {
          x0: (mq.x0 - c.x) / c.k,
          y0: (mq.y0 - c.y) / c.k,
          x1: (mq.x1 - c.x) / c.k,
          y1: (mq.y1 - c.y) / c.k,
        });
        if (caught.length) {
          const primary = selRef.current;
          setMulti((cur) => {
            const next = new Set(cur.size ? cur : primary ? [primary] : []);
            for (const name of caught) next.add(name);
            return next;
          });
          if (!primary) cb.current.onSelect(caught[0]);
        }
        return;
      }
      const d = drag.current;
      if (d) {
        drag.current = null;
        if (d.value === d.from) {
          // A click, or the two presses of a double-click: nothing moved, so nothing is written.
        } else if (d.tgt.kind === "track") {
          if (d.tgt.control === "volume" || d.tgt.control === "pan")
            cb.current.onTrackSet?.(d.tgt.trackId, d.tgt.control, d.value);
          // A module FIELD is a named setting, not a range, so a drag onto one commits nothing.
        } else if (
          d.tgt.kind === "plugin" &&
          d.node.module &&
          !rehearsalRef.current
        ) {
          // Not in a rehearsal: this line WRITES the value into the module's file — docs/hosting.md.
          commitParam(d.node.module, d.tgt, d.value, d.pair, d.w);
          for (const l of d.linked)
            if (l.node.module)
              commitParam(l.node.module, l.tgt, l.value, l.pair, d.w);
        }
        // The override stays until the matching frame arrives (see the reconcile effects).
      }
      if (pan.current) {
        suppressClick.current = pan.current.moved > DRAG_SLOP;
        pan.current = null;
        setPanning(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [setOverride]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Shift on EMPTY space draws a selection box instead of panning — even where the camera is fixed.
    if (
      e.shiftKey &&
      e.button === 0 &&
      !(e.target as HTMLElement).closest(".dgx-node")
    ) {
      const r = hostRef.current?.getBoundingClientRect();
      const x = e.clientX - (r?.left ?? 0);
      const y = e.clientY - (r?.top ?? 0);
      marqueeRef.current = { x0: x, y0: y, x1: x, y1: y };
      setMarquee(marqueeRef.current);
      e.preventDefault();
      return;
    }
    if (fixedRef.current) return;
    flight.current = null;
    // Grabbing the canvas ends any zoom still in flight: you are steering now — docs/camera.md.
    goal.current.k = cam.current.k;
    pan.current = {
      sx: e.clientX,
      sy: e.clientY,
      cx: cam.current.x,
      cy: cam.current.y,
      moved: 0,
    };
  };
  return { marquee, onPointerDown, pan, suppressClick };
}
