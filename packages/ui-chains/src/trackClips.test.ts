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
const clip = (ref: string, start: number): WebTrackClip => ({
  ref,
  start,
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

  it("counts the overflow instead of listing it", () => {
    // A lane with sixty takes would otherwise be a node taller than the window, and this is a
    // picture of the ROUTING — the timeline is where a full clip list belongs.
    const many = Array.from({ length: CLIP_LIST_MAX + 4 }, (_, i) =>
      clip(`take-${i}`, i * 4),
    );
    const n = trackNode(graphWith(many));
    expect(n.clips).toHaveLength(CLIP_LIST_MAX);
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

  it("keeps a missing clip, and says which one it is", () => {
    // The state this list is best at catching: a lane pointing at material that is not there
    // looks exactly like a full one on a routing diagram.
    const n = trackNode(
      graphWith([{ ref: "gone", start: 0, tc: "1:1", kind: "missing" }]),
    );
    expect(n.clips?.[0]).toMatchObject({ ref: "gone", kind: "missing" });
  });
});
