// chainsModel.ts — the compiled geometry of a laid-out graph: the signal cables with their insert
// eligibility, the automation cables, and the edges the ripple walks. Pure, and memoised by
// DomChains on the graph alone — docs/liveCables.md.

import { WOBBLE_MAX_SAMPLES, WOBBLE_STEP } from "@studio/ui-chains/cableCanvas";
import {
  type AutoTarget,
  autoTarget,
  buildCableGeom,
  type CableGeom,
  insertFor,
} from "@studio/ui-chains/cables";
import {
  cablePath,
  type GraphEdge,
  type LaidOutGraph,
} from "@studio/ui-chains/graph";
import { hangPoints } from "@studio/ui-chains/hang";
import type { EdgeGeom } from "./ChainsCables";

/** Signal cables (with insert eligibility), automations, and what the ripple walks. */
export function buildModel(graph: LaidOutGraph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  // With a box OPEN, the cables crossing it are drawn at half, so its own wiring reads first — docs/liveCables.md.
  const anyOpen = graph.nodes.some((n) => n.assemblyOf?.open);
  // …and a CLOSED box has swallowed its lanes' cards, so a metered lane's signal leaves from the box.
  const foldedAt = new Map<string, string>();
  for (const n of graph.nodes)
    if (n.assemblyOf && !n.assemblyOf.open)
      for (const m of n.assemblyOf.members) foldedAt.set(m, n.id);
  const signal: EdgeGeom[] = [];
  // The edges between two TOUCHING cards: never drawn, but the ripple still has to walk through them.
  const glued: GraphEdge[] = [];
  const auto: AutoTarget[] = [];
  // An automation cable is a CABLE: only its param LABEL stays in the SVG, off the AutoTarget list.
  const autoGeom: ({ id: string } & CableGeom)[] = [];
  for (const e of graph.edges) {
    if (e.automation) {
      const a = autoTarget(e, byId);
      if (!a) continue;
      auto.push(a);
      autoGeom.push({
        id: a.id,
        ...buildCableGeom(
          hangPoints(a.from, a.to),
          WOBBLE_STEP,
          WOBBLE_MAX_SAMPLES,
        ),
      });
      continue;
    }
    if (e.glued) {
      glued.push(e);
      continue;
    }
    if (e.points.length < 2) continue;
    signal.push({
      id: e.id,
      // Plugged into the SOCKETS rather than aimed at the borders dagre routed to — see cablePath.
      ...buildCableGeom(
        cablePath(e, byId.get(e.source), byId.get(e.target)),
        WOBBLE_STEP,
        WOBBLE_MAX_SAMPLES,
      ),
      source: e.source,
      target: e.target,
      label: e.label,
      signal: e.signal,
      faded: anyOpen && !e.assembly,
      insert: insertFor(e.source, e.target, byId),
    });
  }
  // What the ripple walks: every signal edge, drawn or glued.
  const flowEdges = glued.length ? [...signal, ...glued] : signal;
  return { byId, signal, flowEdges, auto, autoGeom, foldedAt };
}
