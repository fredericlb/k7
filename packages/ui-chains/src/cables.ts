// cables.ts — the cable DRAWING geometry: smooth a routed polyline into cubic beziers,
// resample it by arc-length for the live-signal wobble, find the insert `+` midpoint,
// build arrowheads, and propagate liveness along the edges. Pure math over the laid-out
// graph (graph.ts owns the layout); no DOM, no React — extracted from the web app's
// DomChains.tsx so it is testable on its own.

import type { EdgeInsert, GraphEdge, GraphNode, Pt } from "./graph";
import { jackPoint } from "./graph";

// graph.ts's trackId() prefix — liveness seeds from the track nodes.
export const TRACK_NODE_PREFIX = "trk:";

// A cubic bezier segment (Catmull-Rom → Bezier — see cubicSegments).
export interface Cubic {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p1: Pt;
}

// The cubic segments a polyline becomes (Catmull-Rom → Bezier). Split out of smoothPath so the wobble samples the
// SAME curve the still cable is drawn along — sampling the raw polyline snapped a live cable to a polygon.
export function cubicSegments(pts: Pt[]): Cubic[] {
  if (pts.length < 2) return [];
  // Two points draw as a straight line; expressed as a degenerate cubic so callers have one shape to handle.
  if (pts.length === 2)
    return [{ p0: pts[0], c1: pts[0], c2: pts[1], p1: pts[1] }];
  const out: Cubic[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    out.push({
      p0: p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p1: p2,
    });
  }
  return out;
}

export const cubicAt = (c: Cubic, t: number): Pt => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p1.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p1.y,
  };
};

// The curve's derivative: the wobble displaces along its perpendicular, so a ripple stays square through a bend.
export const cubicTangent = (c: Cubic, t: number): Pt => {
  const u = 1 - t;
  return {
    x:
      3 * u * u * (c.c1.x - c.p0.x) +
      6 * u * t * (c.c2.x - c.c1.x) +
      3 * t * t * (c.p1.x - c.c2.x),
    y:
      3 * u * u * (c.c1.y - c.p0.y) +
      6 * u * t * (c.c2.y - c.c1.y) +
      3 * t * t * (c.p1.y - c.c2.y),
  };
};

// Convert a polyline to a smooth SVG cubic path, so cables curve instead of jointing between waypoints.
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2)
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (const c of cubicSegments(pts))
    d += ` C ${c.c1.x} ${c.c1.y}, ${c.c2.x} ${c.c2.y}, ${c.p1.x} ${c.p1.y}`;
  return d;
}

// One resampled point on a cable: position, unit normal, and arc-length travelled.
export interface CableSample {
  x: number;
  y: number;
  nx: number;
  ny: number;
  s: number;
}

// A cable's geometry: the base polyline, the evenly-spaced samples the wobble displaces, and the arc length.
export interface CableGeom {
  base: Pt[];
  samples: CableSample[];
  len: number;
}

/**
 * Resample a routed polyline into evenly-spaced points carrying a per-sample normal and
 * arc-length, for a travelling-wave wobble to displace. The base points are kept
 * verbatim for the idle (still) draw.
 *
 * `step` is the target spacing (world px); `maxSamples` caps the count so a very long
 * cable can't explode it.
 */
export function buildCableGeom(
  pts: Pt[],
  step = 8,
  maxSamples = 96,
): CableGeom {
  const base = pts.map((p) => ({ x: p.x, y: p.y }));
  const segs = cubicSegments(base);

  // Walk the CURVE, not the polyline: each cubic is subdivided finely, then resampled at the wobble's spacing, with
  // `s` accumulating real distance — so the travelling wave keeps an even wavelength through a bend.
  const SUB = 16;
  const segLens = segs.map((c) => {
    let l = 0;
    let prev = cubicAt(c, 0);
    for (let i = 1; i <= SUB; i++) {
      const q = cubicAt(c, i / SUB);
      l += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    return l;
  });
  const len = segLens.reduce((a, b) => a + b, 0);
  const spacing = Math.max(step, len / maxSamples);

  const samples: CableSample[] = [];
  let s = 0;
  let prev: Pt | null = null;
  for (let i = 0; i < segs.length; i++) {
    const c = segs[i];
    const segLen = segLens[i];
    if (segLen === 0) continue;
    const steps = Math.max(1, Math.round(segLen / spacing));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const pt = cubicAt(c, t);
      const tan = cubicTangent(c, t);
      const m = Math.hypot(tan.x, tan.y) || 1;
      if (prev) s += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = pt;
      samples.push({ x: pt.x, y: pt.y, nx: -tan.y / m, ny: tan.x / m, s });
    }
  }
  // The endpoint closes the curve: without it a live cable stops short and the arrowhead's angle comes out wrong.
  const last = segs[segs.length - 1];
  if (last) {
    const pt = cubicAt(last, 1);
    const tan = cubicTangent(last, 1);
    const m = Math.hypot(tan.x, tan.y) || 1;
    if (prev) s += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    samples.push({ x: pt.x, y: pt.y, nx: -tan.y / m, ny: tan.x / m, s });
  }
  return { base, samples, len: s };
}

// The midpoint of a cable by arc-length — where the insert `+` sits.
export function midByArc(g: CableGeom): Pt {
  const half = g.len / 2;
  for (const p of g.samples) if (p.s >= half) return { x: p.x, y: p.y };
  return g.base[g.base.length - 1];
}

// `arrowPoints` (the SVG arrowhead string) is gone: the automation cables draw on the
// canvas now, and the head is traced there from the last drawn segment — see drawCables.

/**
 * Which cables carry a signal right now (a Set of edge ids). Liveness starts at the
 * tracks the engine meters above silence and flows FORWARD along edges — a fixpoint
 * loop so a feedback send can't wedge it.
 */
export function computeLive(
  edges: { id: string; source: string; target: string }[],
  activeTracks: string[],
): Set<string> {
  const reached = new Set(
    activeTracks.map((id) => `${TRACK_NODE_PREFIX}${id}`),
  );
  const live = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of edges) {
      if (!live.has(g.id) && reached.has(g.source)) {
        live.add(g.id);
        reached.add(g.target);
        changed = true;
      }
    }
  }
  return live;
}

/**
 * Whether an arrow maps to an insert, and the two ends it would carry: offered whenever
 * at least one end is a module.
 *
 * It used to also demand that both ends belong to the same CHAIN, because the command
 * took a chain name and an index into it. chains.yaml states its edges outright now, so
 * an arrow IS the address — and the cases the same-chain rule quietly refused (a track
 * feeding a bus, a split's branch) are ordinary arrows like any other.
 */
export function insertFor(
  sourceId: string,
  targetId: string,
  byId: Map<string, GraphNode>,
): EdgeInsert | null {
  const s = byId.get(sourceId);
  const t = byId.get(targetId);
  if (!s || !t) return null;
  if (s.kind !== "module" && t.kind !== "module") return null;
  const name = (n: GraphNode) =>
    n.kind === "module" ? (n.module ?? n.label) : n.label;
  return { before: name(s), after: name(t) };
}

/**
 * The chains.yaml name a JACK click has in hand: the node as the chains spell it — the same
 * resolution insertFor uses — plus `#port` when the jack names one. What the patch-cable
 * gesture hands the host, so `graph chain connect` receives addresses the file already speaks.
 */
export function jackRef(n: GraphNode, port?: string): string {
  const name = n.kind === "module" ? (n.module ?? n.label) : n.label;
  return port ? `${name}#${port}` : name;
}

// Where an automation arrow lands: the target widget's centre, or the module's left edge.
export interface AutoTarget {
  id: string;
  from: Pt;
  to: Pt;
  param: string;
  onWidget: boolean;
}

export function autoTarget(
  edge: GraphEdge,
  byId: Map<string, GraphNode>,
): AutoTarget | null {
  const src = byId.get(edge.source);
  const tgt = byId.get(edge.target);
  const a = edge.automation;
  if (!src || !tgt || !a) return null;
  return {
    id: edge.id,
    // Out of the curve's own socket, like every other cable. It KEEPS its arrowhead, unlike a
    // signal cable: it does not plug into anything — it lands on a knob in the middle of a card,
    // and a headless line pointing into a widget grid says nothing about which knob it means.
    from: jackPoint(src, "out", 0),
    to: a.widget
      ? { x: tgt.x + a.widget.x, y: tgt.y + a.widget.y }
      : { x: tgt.x, y: tgt.y + tgt.h / 2 },
    param: a.param,
    onWidget: !!a.widget,
  };
}
