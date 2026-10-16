// useEdgeGestures.ts — the patch cable: one loose end lifted off a jack or drawn from a free one,
// landing as a connect, a replug, a curve binding or a trigger, and dropped on the bare canvas as a
// disconnect. The `+` on a cable answers here too — docs/hosting.md.

import type { WebSignal, WebWidget } from "@studio/graph-model";
import { jackRef, smoothPath } from "@studio/ui-chains/cables";
import {
  curveOutPoint,
  type EdgeInsert,
  eventPoint,
  type GraphEdge,
  type GraphNode,
  type Jack,
  jackPoint,
  type LaidOutGraph,
} from "@studio/ui-chains/graph";
import { hangPoints } from "@studio/ui-chains/hang";
import { patchAct } from "@studio/ui-chains/patchGesture";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import type { Cam } from "./camera";
import type { ChainsCallbacks } from "./domChainsProps";

export function useEdgeGestures({
  cam,
  cb,
  graph,
  hostRef,
  paintRef,
  rebuildCables,
  suppressClick,
}: {
  cam: RefObject<Cam>;
  cb: RefObject<ChainsCallbacks>;
  graph: LaidOutGraph;
  hostRef: RefObject<HTMLDivElement | null>;
  paintRef: RefObject<() => void>;
  rebuildCables: RefObject<() => void>;
  suppressClick: RefObject<boolean>;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const insert = useCallback(
    (info: EdgeInsert, x: number, y: number, at: { x: number; y: number }) => {
      if (suppressClick.current) return;
      cb.current.onEdgeInsert?.(info, x, y, at);
    },
    [],
  );

  // --- the patch cable: one loose end, landing on connect or replug (docs/hosting.md) ---
  const [patch, setPatch] = useState<{
    /** WHAT is being drawn, because the three cables land on different things — docs/hosting.md. */
    kind?: "signal" | "automation" | "event";
    /** The curve this cable belongs to, on both of the two that involve one. */
    curve?: { curve: string; module?: string; param?: string };
    type: WebSignal;
    seeking: "in" | "out"; // which side of a jack lands the loose end
    fixedRef: string; // the plugged end's chains address
    fixedNode: string; // …the node it is ON, which is the one jack gating must NOT offer
    fixedAt: { x: number; y: number }; // …and its socket, where the temp cable is pinned
    // The arrow this WAS, when an existing cable was lifted — absent for a new one.
    edge?: { id: string; from: string; to: string };
  } | null>(null);
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const patchEl = useRef<SVGPathElement | null>(null);
  // The laid-out graph, in a ref, so `tapJack` stays stable while reading the current layout.
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // Screen → world, the inverse of the camera `applyCam` writes — the one place that needs it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const toWorld = useCallback((cx: number, cy: number) => {
    const r = hostRef.current?.getBoundingClientRect();
    const c = cam.current;
    return {
      x: (cx - (r?.left ?? 0) - c.x) / c.k,
      y: (cy - (r?.top ?? 0) - c.y) / c.k,
    };
  }, []);

  /** The dashed promise HANGS like the cable it becomes; `f` is always the OUT end. */
  const patchD = (f: { x: number; y: number }, t: { x: number; y: number }) =>
    smoothPath(hangPoints(f, t));

  // The ref is written before the state lands, because `rebuildCables` reads the ref.
  const setPatchNow = (next: typeof patchRef.current): void => {
    patchRef.current = next;
    setPatch(next);
    rebuildCables.current();
    paintRef.current();
  };

  // The socket THIS press armed from, so its own release lands nothing; cleared by every release.
  const armedFrom = useRef<string | null>(null);

  /** The loose end went into `p`: a lifted cable moves one of its ends, a new one is drawn. */
  const landPatch = (
    cur: NonNullable<typeof patchRef.current>,
    n: GraphNode,
    p: Jack,
  ): void => {
    const landed = jackRef(n, p.name);
    if (cur.edge) {
      const nf = cur.seeking === "out" ? landed : cur.edge.from;
      const nt = cur.seeking === "in" ? landed : cur.edge.to;
      cb.current.onReplug?.(cur.edge.from, cur.edge.to, nf, nt);
    } else {
      cb.current.onConnect?.(cur.fixedRef, landed);
    }
    setPatchNow(null);
  };

  // The three halves of the two curve cables, committing through ONE callback — docs/hosting.md.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const startAutomation = useCallback((n: GraphNode) => {
    suppressClick.current = false;
    if (!n.curveOf) return;
    setPatchNow({
      kind: "automation",
      curve: n.curveOf,
      type: "event", // mauve, and never type-matched against a signal jack
      seeking: "in",
      fixedRef: n.id,
      fixedNode: n.id,
      fixedAt: curveOutPoint(n),
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const landAutomation = useCallback((n: GraphNode, w: WebWidget) => {
    const cur = patchRef.current;
    if (!cur?.curve || !n.module || !w.bind) return;
    cb.current.onAutomate?.(n.module, w.bind, cur.curve.curve);
    setPatchNow(null);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const startEvent = useCallback((n: GraphNode, event: string) => {
    suppressClick.current = false;
    setPatchNow({
      kind: "event",
      type: "event",
      seeking: "in",
      fixedRef: n.id,
      fixedNode: n.id,
      fixedAt: eventPoint(n, "out", Math.max(0, n.events?.indexOf(event) ?? 0)),
      // The module the note-on leaves — what becomes the binding's `trigger`.
      curve: { curve: "", module: n.module ?? n.label },
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const landEvent = useCallback((n: GraphNode) => {
    const cur = patchRef.current;
    const b = n.curveOf;
    // A free card has no binding to write a trigger onto — the second guard, not the only one.
    if (cur?.kind !== "event" || !b?.module || !b.param) return;
    cb.current.onAutomate?.(b.module, b.param, b.curve, cur.curve?.module);
    setPatchNow(null);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setPatchNow reads refs only, and the inputs DomChains hands in are refs.
  const tapJack = useCallback(
    (
      n: GraphNode,
      side: "in" | "out",
      p: Jack,
      index: number,
      phase: "down" | "up",
    ) => {
      const cur = patchRef.current;
      const here = jackRef(n, p.name);
      // A press STARTS a gesture, so it clears the flag itself: no pointerup will — docs/hosting.md.
      if (phase === "down") suppressClick.current = false;
      const act = patchAct(phase, !!cur, armedFrom.current, here);
      if (phase === "up" || act === "land") {
        // NodeInner arms only jacks of the seeking side, free and type-matched: land it.
        if (cur && act === "land") landPatch(cur, n, p);
        armedFrom.current = null;
        return;
      }
      armedFrom.current = here;
      if (p.free) {
        // A free OUT jack starts a NEW cable (a free IN jack is never armed at rest).
        setPatchNow({
          type: p.type,
          seeking: "in",
          fixedRef: jackRef(n, p.name),
          fixedNode: n.id,
          fixedAt: jackPoint(n, "out", index),
        });
        return;
      }
      // An occupied jack lifts the FIRST signal cable's end off it, where a drop has somewhere to go.
      if (!cb.current.onReplug || !cb.current.onDisconnect) return;
      const g = graphRef.current;
      // Matched by the port the cable NAMES — or the FIRST jack when it names none, docs/hosting.md.
      const portOf = (ed: GraphEdge) =>
        (side === "out" ? ed.sourcePort : ed.targetPort) ?? undefined;
      const e = g.edges.find(
        (ed) =>
          !ed.automation &&
          (side === "out" ? ed.source : ed.target) === n.id &&
          (portOf(ed) === (p.name ?? undefined) ||
            (portOf(ed) === undefined && index === 0)),
      );
      if (!e) return; // only automation plugs here — those cables are edited on the module
      const src = g.nodes.find((x) => x.id === e.source);
      const tgt = g.nodes.find((x) => x.id === e.target);
      if (!src || !tgt) return;
      const from = jackRef(src, e.sourcePort);
      const to = jackRef(tgt, e.targetPort);
      const inIndex = Math.max(
        0,
        tgt.jacks?.in.findIndex((j) => j.name === e.targetPort) ?? 0,
      );
      const outIndex = Math.max(
        0,
        src.jacks?.out.findIndex((j) => j.name === e.sourcePort) ?? 0,
      );
      setPatchNow(
        side === "out"
          ? {
              // The source end comes off: the loose end seeks a new OUT jack to leave from.
              type: p.type,
              seeking: "out",
              fixedRef: to,
              fixedNode: tgt.id,
              fixedAt: jackPoint(tgt, "in", inIndex),
              edge: { id: e.id, from, to },
            }
          : {
              // The target end comes off: the source stays plugged, as a new cable would be.
              type: p.type,
              seeking: "in",
              fixedRef: from,
              fixedNode: src.id,
              fixedAt: jackPoint(src, "out", outIndex),
              edge: { id: e.id, from, to },
            },
      );
    },
    [],
  );

  // Direct DOM on every move, no re-render: the cable's loose end is the cursor, 60 times a second.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const movePatch = useCallback(
    (e: React.PointerEvent) => {
      const cur = patchRef.current;
      const el = patchEl.current;
      if (!cur || !el) return;
      const w = toWorld(e.clientX, e.clientY);
      el.setAttribute(
        "d",
        cur.seeking === "in" ? patchD(cur.fixedAt, w) : patchD(w, cur.fixedAt),
      );
    },
    [toWorld],
  );

  // What every node's jack gating reads — memoised, or a new object would re-render all the cards.
  const patchWant = useMemo(
    () =>
      patch
        ? {
            seeking: patch.seeking,
            type: patch.type,
            node: patch.fixedNode,
            kind: patch.kind ?? "signal",
          }
        : null,
    [patch],
  );

  // A cable dropped on the BARE canvas is DELETED; a new one simply ceases — docs/hosting.md.
  const canvasDrop = (e: React.MouseEvent): boolean => {
    const cur = patchRef.current;
    if (!cur || suppressClick.current) return false;
    const t = e.target as HTMLElement;
    if (t !== hostRef.current && !t.classList?.contains("dgx-world"))
      return false;
    if (cur.edge) cb.current.onDisconnect?.(cur.edge.from, cur.edge.to);
    setPatchNow(null);
    return true;
  };
  return {
    canvasDrop,
    insert,
    landAutomation,
    landEvent,
    movePatch,
    patch,
    patchD,
    patchEl,
    patchRef,
    patchWant,
    setPatch,
    startAutomation,
    startEvent,
    tapJack,
    toWorld,
  };
}
