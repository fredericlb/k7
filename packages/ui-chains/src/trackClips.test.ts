// A track node LISTS what its lane holds. The graph says where a signal goes; without this it
// never said what plays, so "which take is on this lane" meant opening the timeline.
// See CLIP_LIST_MAX and `clipsOf` in graph.ts.

import type { WebGraph, WebTrackClip } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, CLIP_LIST_MAX } from "./graph";

/** A one-track, one-module graph, with whatever clips the case wants on the lane. */
const graphWith = (clips?: WebTrackClip[]): WebGraph => ({
  tracks: ["gtr"],
  chains: {
    gtr: {
      from: "gtr",
      use: [{ module: "amp" }],
      out: [{ to: "OUT", gain: 1 }],
    },
  },
  ...(clips ? { trackClips: { gtr: clips } } : {}),
  warnings: [],
});

// `tc` is what the file service already spelled with `beatsToPosition` — the renderer never
// divides beats itself, so here it is simply carried. Written the way that function writes it:
// the shortest form, so a downbeat is `5:1` and not `5:1:1`.
const clip = (ref: string, start: number, len?: number): WebTrackClip => ({
  ref,
  start,
  ...(len === undefined ? {} : { len }),
  tc: `${Math.floor(start / 4) + 1}:${(start % 4) + 1}`,
  kind: "audio",
});

const trackNode = (g: WebGraph) => {
  const n = buildGraph(g, { drawMainOut: false }).nodes.find(
    (x) => x.kind === "track",
  );
  if (!n) throw new Error("no track node");
  return n;
};

describe("a track node's clip list", () => {
  it("carries the lane's clips, each with the position it plays at", () => {
    const n = trackNode(graphWith([clip("verse", 0), clip("chorus", 16)]));
    expect(n.clips?.map((c) => c.ref)).toEqual(["verse", "chorus"]);
    // The timecode is drawn to the LEFT of the name, and is spelled by the file service — the
    // renderer never divides beats into bars, or two places would answer "where is this clip".
    expect(n.clips?.map((c) => c.tc)).toEqual(["1:1", "5:1"]);
  });

  it("is taller than the same lane with nothing on it", () => {
    // The height is what dagre is told, so the list has to be paid for BEFORE anything is
    // drawn — otherwise the rows spill out of the card the layout reserved.
    const empty = trackNode(graphWith());
    const full = trackNode(graphWith([clip("verse", 0)]));
    expect(full.h).toBeGreaterThan(empty.h);
    // …and no wider: a card's width is its mixer grid's, and a long clip name is ellipsed
    // rather than allowed to push the whole rank sideways.
    expect(full.w).toBe(empty.w);
  });

  it("adds NOTHING to a lane with no clips", () => {
    // Not an empty list and not a heading: a node that has grown to say "0 clips" has grown to
    // tell you nothing. `clips` is absent, which is what the renderer tests.
    const n = trackNode(graphWith());
    expect(n.clips).toBeUndefined();
    expect(n.clipsMore).toBeUndefined();
  });

  it("counts the LIST's overflow while keeping every clip for the timeline", () => {
    // Two different jobs. The list shows the first few and says how many it left out — a lane
    // with sixty takes would otherwise be a node taller than the window. The mini timeline
    // above it draws them ALL, because a picture of the lane with clips missing from it is
    // worse than no picture: it would say the lane is emptier than it is.
    const many = Array.from({ length: CLIP_LIST_MAX + 4 }, (_, i) =>
      clip(`take-${i}`, i * 4),
    );
    const n = trackNode(graphWith(many));
    expect(n.clips).toHaveLength(CLIP_LIST_MAX + 4);
    expect(n.clipsMore).toBe(4);
  });

  it("says nothing extra when the list fits exactly", () => {
    const exact = Array.from({ length: CLIP_LIST_MAX }, (_, i) =>
      clip(`take-${i}`, i * 4),
    );
    const n = trackNode(graphWith(exact));
    expect(n.clips).toHaveLength(CLIP_LIST_MAX);
    expect(n.clipsMore).toBeUndefined();
  });
});

describe("the mini timeline's scale", () => {
  /** Two lanes, so the shared scale has something to be shared BETWEEN. */
  const twoLanes = (a: WebTrackClip[], b: WebTrackClip[]): WebGraph => ({
    tracks: ["gtr", "bass"],
    chains: {
      gtr: { from: "gtr", use: [], out: [{ to: "OUT", gain: 1 }] },
      bass: { from: "bass", use: [], out: [{ to: "OUT", gain: 1 }] },
    },
    trackClips: { gtr: a, bass: b },
    warnings: [],
  });
  const at = (g: WebGraph, track: string) =>
    buildGraph(g, { drawMainOut: false })
      .nodes.find((n) => n.kind === "track" && n.label === track)
      ?.clips?.map((c) => c.at);

  it("is SHARED by every lane, not each lane's own extent", () => {
    // The whole point. A per-lane scale would draw the bass's last clip hard against its right
    // edge at bar 2 and the guitar's at bar 33, side by side, both claiming to show where
    // things are — which is worse than no timeline, because it is believable.
    const g = twoLanes(
      [clip("a", 0, 4), clip("b", 96, 32)],
      [clip("c", 0, 4), clip("d", 32, 4)],
    );
    // The span is the END of the last clip — 96 + 32 = 128 — so the longest lane fills it.
    expect(at(g, "gtr")).toEqual([0, 0.75]);
    // A quarter of the way along, because 32 is a quarter of 128 — not at its own end.
    expect(at(g, "bass")).toEqual([0, 0.25]);
  });

  it("runs the scale to the END of the last clip, not its start", () => {
    // Otherwise the final block — usually the longest — hangs off the right of every node.
    const g = twoLanes([clip("a", 0, 64)], [clip("b", 0, 4)]);
    const gtr = buildGraph(g, { drawMainOut: false }).nodes.find(
      (n) => n.kind === "track" && n.label === "gtr",
    );
    expect(gtr?.clips?.[0]).toMatchObject({ at: 0, w: 1 });
  });

  it("gives a very short clip a width you can still hit", () => {
    // A one-bar clip in a six-minute song is a fraction of a percent: invisible, and impossible
    // to hover. The floor is what keeps the timeline usable for finding things.
    const g = twoLanes([clip("a", 0, 1), clip("b", 400, 4)], [clip("c", 0, 4)]);
    const w = buildGraph(g, { drawMainOut: false }).nodes.find(
      (n) => n.kind === "track" && n.label === "gtr",
    )?.clips?.[0].w;
    expect(w).toBeGreaterThan(0.01);
  });

  it("puts everything at the start when nothing is past bar 1", () => {
    // No span to divide by, and 0 is where they all are anyway — not a NaN from x/0.
    const g = twoLanes([clip("a", 0)], [clip("b", 0)]);
    expect(at(g, "gtr")).toEqual([0]);
    expect(at(g, "bass")).toEqual([0]);
  });

  it("keeps a missing clip, and says which one it is", () => {
    // The state this list is best at catching: a lane pointing at material that is not there
    // looks exactly like a full one on a routing diagram.
    const n = trackNode(
      graphWith([{ ref: "gone", start: 0, tc: "1:1", kind: "missing" }]),
    );
    expect(n.clips?.[0]).toMatchObject({ ref: "gone", kind: "missing" });
  });
});
