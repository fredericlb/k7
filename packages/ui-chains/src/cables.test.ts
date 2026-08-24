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
  jackRef,
  liveVideoLanes,
  MIX_NODE_ID,
  midByArc,
  RENDER_NODE_ID,
  smoothPath,
  TRACK_NODE_PREFIX,
} from "./cables";
import type { GraphNode } from "./graph";

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

  // Nothing arrives at MIX, so liveness has to be SEEDED there — see docs/graphBuild.md.
  describe("the master run", () => {
    const edges = [
      edge("lane", `${TRACK_NODE_PREFIX}melody`, "mod:reverb"),
      edge("master", MIX_NODE_ID, "mod:comp"),
      edge("device", "mod:comp", "snk:OUT"),
    ];

    it("lights when any track is metered, with the master chain behind it", () => {
      expect(computeLive(edges, ["melody"])).toEqual(
        new Set(["lane", "master", "device"]),
      );
    });

    it("lights for a track whose own cables are not drawn at all", () => {
      // Every lane ends at the sum, so a lane with no chain still feeds it.
      expect(computeLive(edges, ["pad"])).toEqual(
        new Set(["master", "device"]),
      );
    });

    it("stays still when nothing is playing", () => {
      expect(computeLive(edges, [])).toEqual(new Set());
    });
  });

  // The picture's half: its lanes arrive on their own list, nothing metering a frame.
  describe("the picture", () => {
    const edges = [
      edge("lane", `${TRACK_NODE_PREFIX}cam`, "mod:blur"),
      edge("master", RENDER_NODE_ID, "snk:VIDEO_OUT"),
      edge("sound", `${TRACK_NODE_PREFIX}melody`, "mod:reverb"),
    ];

    it("lights a video lane's cables and the run out of RENDER", () => {
      expect(computeLive(edges, [], ["cam"])).toEqual(
        new Set(["lane", "master"]),
      );
    });

    it("leaves the frame still while only sound is playing", () => {
      expect(computeLive(edges, ["melody"])).toEqual(new Set(["sound"]));
    });
  });
});

describe("liveVideoLanes", () => {
  const spans = {
    cam: [
      { from: 0, to: 2 },
      { from: 4, to: Number.POSITIVE_INFINITY },
    ],
    titles: [{ from: 1, to: 3 }],
  };

  it("names every lane showing a picture at that second", () => {
    expect(liveVideoLanes(spans, 1.5)).toEqual(["cam", "titles"]);
    expect(liveVideoLanes(spans, 2.5)).toEqual(["titles"]);
    expect(liveVideoLanes(spans, 3.5)).toEqual([]);
    expect(liveVideoLanes(spans, 900)).toEqual(["cam"]);
  });

  // Half-open, like the compositor's activeAt: a cut belongs to the later shot.
  it("ends a span before its `to`", () => {
    expect(liveVideoLanes({ cam: [{ from: 0, to: 2 }] }, 2)).toEqual([]);
    expect(liveVideoLanes({ cam: [{ from: 0, to: 2 }] }, 0)).toEqual(["cam"]);
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
    // A same-chain rule would refuse this; `chains.yaml` states its edges. docs/graphBuild.md.
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

describe("jackRef", () => {
  // A track node's id wears the trk: prefix but its LABEL is the chains name — same for the sink.
  const node = (
    kind: GraphNode["kind"],
    id: string,
    label: string,
    module?: string,
  ) => ({ id, kind, label, module }) as GraphNode;

  it("names a node as the chains spell it, exactly as insertFor does", () => {
    expect(jackRef(node("module", "m1", "reverb (long)", "reverb"))).toBe(
      "reverb",
    );
    expect(jackRef(node("track", "trk:gtr", "gtr"))).toBe("gtr");
    expect(jackRef(node("sink", "sink", "OUT"))).toBe("OUT");
  });

  it("suffixes the port the jack names, in the file's own spelling", () => {
    expect(jackRef(node("module", "m1", "split", "split"), "b")).toBe(
      "split#b",
    );
  });
});
