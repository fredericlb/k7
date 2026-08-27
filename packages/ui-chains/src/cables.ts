// cables.ts — the cable DRAWING geometry: smooth a routed polyline into cubic beziers,
// resample it by arc-length for the live-signal wobble, find the insert `+` midpoint,
// build arrowheads, and propagate the SIGNAL'S STRENGTH along the edges. Pure math over the laid-out
// graph (graph.ts owns the layout); no DOM, no React, so it is testable on its own.

import { flowOf, type NodeFlow, STILL } from "./flow";
import type { EdgeInsert, GraphEdge, GraphNode, Pt } from "./graph";
import { jackPoint, MIX_OUT, RENDER_OUT } from "./graph";

// graph.ts's trackId() prefix — liveness seeds from the track nodes.
export const TRACK_NODE_PREFIX = "trk:";

// …and its moduleId()'s, which liveness ALSO seeds from: a materialised track has no lane card.
export const MODULE_NODE_PREFIX = "mod:";

// …and its sinkId() for the two SUMS, the other nodes the walk starts at — see computeFlow.
export const MIX_NODE_ID = `snk:${MIX_OUT}`;
export const RENDER_NODE_ID = `snk:${RENDER_OUT}`;

// A cubic bezier segment (Catmull-Rom → Bezier — see cubicSegments).
export interface Cubic {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p1: Pt;
}

// The cubics a polyline becomes, split out so the wobble samples the SAME curve. See docs/wobble.md.
export function cubicSegments(pts: Pt[]): Cubic[] {
  if (pts.length < 2) return [];
  // Two points draw straight, expressed as a degenerate cubic so callers have one shape to handle.
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

// The curve's derivative: the wobble displaces along its perpendicular, so a ripple stays square.
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

// A cable's geometry: the base polyline, the samples the wobble displaces, and the arc length.
export interface CableGeom {
  base: Pt[];
  samples: CableSample[];
  len: number;
}

/** Resample a polyline into evenly-spaced points carrying a normal and arc-length, base kept verbatim. */
export function buildCableGeom(
  pts: Pt[],
  step = 8,
  maxSamples = 96,
): CableGeom {
  const base = pts.map((p) => ({ x: p.x, y: p.y }));
  const segs = cubicSegments(base);

  // Walk the CURVE, not the polyline, `s` accumulating real distance so a wavelength stays even.
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
  // The endpoint closes the curve, or a live cable stops short and its arrowhead's angle is wrong.
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

// No SVG arrowhead string here: the head is traced in drawCables.

/**
 * HOW HARD each cable ripples now, walked FORWARD from the metered lanes and both SUMS, and
 * BACKWARD from each metered card. See docs/graphBuild.md and ui-chains-react/docs/liveCables.md.
 *
 * The seed a node carries travels with the signal, and each cable takes from it the number that
 * matches what IT carries (`flowOf`). That is what lets one lane drive two different ripples: the
 * MIDI cable into an instrument moves with the notes, and the audio cable out of it with the
 * meter — one seed, two readings, because the wires are not carrying the same thing.
 */
export function computeFlow(
  edges: {
    id: string;
    source: string;
    target: string;
    signal?: "audio" | "midi" | "video" | "event";
  }[],
  /** What each metered lane or sum is putting out, by node id. Absent = nothing at all. */
  seeds: ReadonlyMap<string, NodeFlow>,
  /** Where a metered lane's signal LEAVES from when its card has been folded into a closed
   *  assembly, by track id. Without it a folded set reaches nothing and no cable ripples. */
  foldedAt: ReadonlyMap<string, string> = new Map(),
): Map<string, number> {
  const reached = new Map<string, NodeFlow>();
  const seed = (node: string, f: NodeFlow): void => {
    const had = reached.get(node);
    reached.set(node, had ? louder(had, f) : f);
  };
  for (const [id, f] of seeds) {
    seed(`${TRACK_NODE_PREFIX}${id}`, f);
    // A run that MATERIALISED its own track is drawn as its MODULES: there is no lane card to
    // start at, and the track wears the chain's name — packages/song/docs/graphModel.md.
    seed(`${MODULE_NODE_PREFIX}${id}`, f);
    const box = foldedAt.get(id);
    if (box) seed(box, f);
    // Both sums carry whatever reaches them; which one depends on what the lane puts out.
    if (f.audio > STILL) seed(MIX_NODE_ID, f);
    if (f.video > STILL) seed(RENDER_NODE_ID, f);
  }
  const flow = new Map<string, number>();
  const walk = (back: boolean): void => {
    const seen = new Map(reached);
    let changed = true;
    while (changed) {
      changed = false;
      for (const g of edges) {
        const here = back ? g.target : g.source;
        const next = back ? g.source : g.target;
        // Upstream stops at another LANE: a metered card speaks for itself, and would be seeded.
        if (back && next.startsWith(TRACK_NODE_PREFIX)) continue;
        const f = seen.get(here);
        if (!f) continue;
        // Only what MOVES is recorded: a zero entry would keep the ripple's rAF running for a
        // cable that hangs still, and `size === 0` is how that loop knows to stop.
        const v = flowOf(f, g.signal);
        const had = flow.get(g.id) ?? 0;
        if (v > had) flow.set(g.id, v);
        else if (seen.has(next)) continue;
        const was = seen.get(next);
        if (!was || louder(was, f) !== was) {
          seen.set(next, was ? louder(was, f) : f);
          changed = true;
        }
      }
    }
  };
  walk(false);
  // …and UPSTREAM of each metered card, which is where a live input sits: the signal it is
  // metering came down that cable. Seeded separately, so a silent sibling branch stays still.
  walk(true);
  return flow;
}

/** The louder of two seeds, per kind — the SAME object when the first already wins on all three. */
function louder(a: NodeFlow, b: NodeFlow): NodeFlow {
  if (a.audio >= b.audio && a.midi >= b.midi && a.video >= b.video) return a;
  return {
    audio: Math.max(a.audio, b.audio),
    midi: Math.max(a.midi, b.midi),
    video: Math.max(a.video, b.video),
  };
}

/** A stretch of time one video lane is on screen, in SECONDS; `to` may be `Infinity`. See @studio/ui-eyes. */
export interface LaneSpan {
  from: number;
  to: number;
}

/** Which VIDEO lanes carry a picture at `t`, half-open as `activeAt` is. See docs/graphBuild.md. */
export function liveVideoLanes(
  spans: Readonly<Record<string, readonly LaneSpan[]>>,
  t: number,
): string[] {
  const ids: string[] = [];
  for (const id in spans)
    if (spans[id].some((s) => t >= s.from && t < s.to)) ids.push(id);
  return ids;
}

/** Whether an arrow maps to an insert: at least one end a module, or the two built-in ends of a master run. */
export function insertFor(
  sourceId: string,
  targetId: string,
  byId: Map<string, GraphNode>,
): EdgeInsert | null {
  const s = byId.get(sourceId);
  const t = byId.get(targetId);
  if (!s || !t) return null;
  // Sink to sink is `MIX → OUT`, the empty master run — the one line every template writes to be dropped on.
  const masterRun = s.kind === "sink" && t.kind === "sink";
  // A closed box stands for a MODULE at one end, which is what makes its boundary arrow spliceable.
  const spliceable = (n: GraphNode) => n.kind === "module" || !!n.assemblyOf;
  if (!spliceable(s) && !spliceable(t) && !masterRun) return null;
  // The box's own name is never written into a chain: the arrow's real end is the MEMBER behind its plug.
  return {
    before: jackRef(s, portOn(s, "out")),
    after: jackRef(t, portOn(t, "in")),
  };
}

/** A closed box's only plug on that side, when it has exactly one — what an ARROW's end must resolve to. */
function portOn(n: GraphNode, side: "in" | "out"): string | undefined {
  if (!n.assemblyOf) return undefined;
  const jacks = n.jacks?.[side]?.filter((j) => j.name);
  return jacks?.length === 1 ? jacks[0].name : undefined;
}

/** The chains.yaml name a JACK click has in hand — `insertFor`'s resolution, plus `#port`.
 *
 * An ASSEMBLY answers with the MEMBER behind the plug, never with itself: the box is a drawing and
 * `graph.yaml` has no key for it, so a cable dropped on `turntableA#mix` writes `fadeA`. Its bare
 * name is still its own — that is what a pin and `graph move` address. See docs/graphBuild.md. */
export function jackRef(n: GraphNode, port?: string): string {
  if (n.assemblyOf && port) {
    const plug = n.assemblyOf.plugs[port];
    if (plug) return plug.port ? `${plug.node}#${plug.port}` : plug.node;
  }
  const name =
    n.kind === "module" || n.kind === "assembly"
      ? (n.module ?? n.label)
      : n.label;
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
    // Out of the curve's own socket, and it KEEPS its arrowhead: it lands on a knob, not in a hole.
    from: jackPoint(src, "out", 0),
    to: a.widget
      ? { x: tgt.x + a.widget.x, y: tgt.y + a.widget.y }
      : { x: tgt.x, y: tgt.y + tgt.h / 2 },
    param: a.param,
    onWidget: !!a.widget,
  };
}
