// cables.test.ts — the cable geometry's contracts: the smoothed curve passes through
// its endpoints, the resampling walks the whole arc, the insert midpoint sits on the
// cable, and liveness flows forward (and only forward) through a feedback loop.

import { describe, expect, it } from "vitest";
import {
  buildCableGeom,
  computeLive,
  cubicAt,
  cubicSegments,
  insertFor,
  midByArc,
  smoothPath,
  smoothPathXY,
  TRACK_NODE_PREFIX,
} from "./cables";
import type { GraphNode, Pt } from "./graph";

const line = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];
const bend = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

describe("cubicSegments", () => {
  it("is empty below two points, degenerate-straight at two", () => {
    expect(cubicSegments([])).toEqual([]);
    expect(cubicSegments([{ x: 1, y: 1 }])).toEqual([]);
    const [c] = cubicSegments(line);
    expect(cubicAt(c, 0)).toEqual({ x: 0, y: 0 });
    expect(cubicAt(c, 1)).toEqual({ x: 100, y: 0 });
  });

  it("passes through every waypoint (Catmull-Rom interpolates)", () => {
    const segs = cubicSegments(bend);
    expect(segs).toHaveLength(2);
    expect(cubicAt(segs[0], 0)).toEqual(bend[0]);
    expect(cubicAt(segs[0], 1)).toEqual(bend[1]);
    expect(cubicAt(segs[1], 1)).toEqual(bend[2]);
  });
});

describe("smoothPath", () => {
  it("draws two points as a straight line, more as cubics", () => {
    expect(smoothPath(line)).toBe("M 0 0 L 100 0");
    expect(smoothPath(bend)).toMatch(/^M 0 0( C [^C]+){2}$/);
    expect(smoothPath([])).toBe("");
  });
});

describe("smoothPathXY", () => {
  // The flat emitter's ONLY contract: same string, no objects. Byte equality is what lets the
  // wobble use it without anyone having to re-argue that the curve is unchanged.
  const flat = (pts: Pt[]): Float64Array => {
    const xy = new Float64Array(pts.length * 2 + 8); // deliberately longer than it needs
    pts.forEach((p, i) => {
      xy[i * 2] = p.x;
      xy[i * 2 + 1] = p.y;
    });
    return xy;
  };
  const same = (pts: Pt[]) =>
    expect(smoothPathXY(flat(pts), pts.length)).toBe(smoothPath(pts));

  it("draws exactly what smoothPath draws", () => {
    same([]);
    same([{ x: 1, y: 1 }]);
    same(line);
    same(bend);
  });

  it("agrees on the wobbled, irrational coordinates it exists for", () => {
    // The real input: a resampled cable pushed off its normals, so nothing lands on a round number.
    const g = buildCableGeom([
      { x: 0, y: 0 },
      { x: 137, y: 41 },
      { x: 210, y: 190 },
      { x: 33, y: 260 },
    ]);
    for (const phase of [0, 0.7, Math.PI, 4.2]) {
      const pts = g.samples.map((p) => {
        const off =
          2.5 *
          Math.sin(Math.PI * (p.s / g.len)) *
          Math.sin((Math.PI * 2 * p.s) / 40 - phase);
        return { x: p.x + p.nx * off, y: p.y + p.ny * off };
      });
      same(pts);
    }
  });

  it("reads only `count` points, so one buffer serves cables of every length", () => {
    const xy = flat(bend.concat([{ x: 999, y: 999 }]));
    expect(smoothPathXY(xy, bend.length)).toBe(smoothPath(bend));
  });
});

describe("buildCableGeom", () => {
  it("keeps the base polyline verbatim and measures the arc", () => {
    const g = buildCableGeom(line);
    expect(g.base).toEqual(line);
    expect(g.len).toBeCloseTo(100, 5);
  });

  it("samples are monotonic in arc-length and end at the endpoint", () => {
    const g = buildCableGeom(bend);
    for (let i = 1; i < g.samples.length; i++)
      expect(g.samples[i].s).toBeGreaterThanOrEqual(g.samples[i - 1].s);
    const last = g.samples[g.samples.length - 1];
    expect(last.x).toBeCloseTo(100, 5);
    expect(last.y).toBeCloseTo(100, 5);
    // The bend makes the curve longer than the two chords' minimum straight run.
    expect(g.len).toBeGreaterThanOrEqual(200 - 1e-6);
  });

  it("normals are unit-length", () => {
    for (const p of buildCableGeom(bend).samples)
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 5);
  });
});

describe("midByArc", () => {
  it("lands halfway down a straight cable", () => {
    const m = midByArc(buildCableGeom(line));
    expect(m.y).toBeCloseTo(0, 5);
    expect(Math.abs(m.x - 50)).toBeLessThanOrEqual(10); // within one sample step
  });
});

describe("computeLive", () => {
  const edge = (id: string, source: string, target: string) => ({
    id,
    source,
    target,
  });

  it("flows forward from active tracks only", () => {
    const t = `${TRACK_NODE_PREFIX}melody`;
    const edges = [
      edge("a", t, "m1"),
      edge("b", "m1", "out"),
      edge("c", "other", "out"),
    ];
    expect(computeLive(edges, ["melody"])).toEqual(new Set(["a", "b"]));
    expect(computeLive(edges, [])).toEqual(new Set());
  });

  it("terminates on a feedback loop and lights the whole cycle", () => {
    const t = `${TRACK_NODE_PREFIX}vox`;
    const edges = [
      edge("in", t, "m1"),
      edge("fwd", "m1", "m2"),
      edge("back", "m2", "m1"), // the feedback send
    ];
    expect(computeLive(edges, ["vox"])).toEqual(new Set(["in", "fwd", "back"]));
  });
});

describe("insertFor", () => {
  const node = (
    id: string,
    kind: GraphNode["kind"],
    chain?: string,
  ): GraphNode =>
    ({
      id,
      kind,
      label: id,
      chain,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    }) as GraphNode;
  const byId = (...nodes: GraphNode[]) => new Map(nodes.map((n) => [n.id, n]));

  it("offers an insert between two modules", () => {
    const m = byId(node("a", "module", "ch"), node("b", "module", "ch"));
    expect(insertFor("a", "b", m)).toEqual({ before: "a", after: "b" });
  });

  it("offers one ACROSS chains too — an arrow is an arrow", () => {
    // It used to refuse this, because the command took a chain name and an index into it.
    // chains.yaml states its edges outright now, so a track feeding a bus (or a split's
    // branch) is an ordinary arrow, and refusing it only hid a `+` that would have worked.
    expect(
      insertFor(
        "a",
        "b",
        byId(node("a", "module", "x"), node("b", "module", "y")),
      ),
    ).toEqual({ before: "a", after: "b" });
  });

  it("refuses between two non-modules", () => {
    // Two tracks never have an arrow, so a `+` there would address nothing.
    expect(
      insertFor("a", "b", byId(node("a", "track"), node("b", "track"))),
    ).toBeNull();
  });
});
