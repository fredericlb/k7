// Which nodes a freeze reaches.
//
// The backend says one thing — "this TRACK is frozen" — and the graph has to work out the rest, because the
// modules are what the user sees and clicks. Getting it wrong is not cosmetic: an unmarked module still offers a
// bypass button and a live knob, both aimed at a plugin the engine never built, and both silently discarded.
//
// The two ways to get it wrong pull in opposite directions. Stop at the track and the baked modules look live;
// mark anything a frozen chain touches and a SHARED module — a reverb bus fed by four tracks, one of them frozen —
// goes grey while it is still processing the other three.

import type { WebGraph } from "@lanes/web-shared";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[],
  frozenTracks: string[],
): WebGraph => ({ chains, tracks, frozenTracks, warnings: [] });

const byId = (g: WebGraph) =>
  Object.fromEntries(buildGraph(g).nodes.map((n) => [n.id, n]));

describe("the frozen mark", () => {
  it("reaches the track and every module of its chain", () => {
    const n = byId(
      graph(
        {
          lead: {
            from: "melody",
            use: [{ module: "synth" }, { module: "amp" }],
            out: [{ to: "OUT", gain: 1 }],
          },
        },
        ["melody"],
        ["melody"],
      ),
    );
    expect(n["trk:melody"]?.frozen).toBe(true);
    expect(n["mod:synth"]?.frozen).toBe(true);
    expect(n["mod:amp"]?.frozen).toBe(true);
    // The sink is nobody's render — it is where every chain in the song ends up.
    expect(n["snk:OUT"]?.frozen).toBeFalsy();
  });

  it("leaves a live track's chain alone", () => {
    const n = byId(
      graph(
        {
          lead: { from: "melody", use: [{ module: "synth" }], out: [] },
          bass: { from: "low", use: [{ module: "sub" }], out: [] },
        },
        ["melody", "low"],
        ["melody"],
      ),
    );
    expect(n["mod:synth"]?.frozen).toBe(true);
    expect(n["trk:low"]?.frozen).toBeFalsy();
    expect(n["mod:sub"]?.frozen).toBeFalsy();
  });

  it("spares a module shared with a chain that is still live", () => {
    // The reverb is on both chains. One track froze; the other still sends into it, so it is still running, and
    // marking it frozen would grey out a module the user can and should still edit.
    const n = byId(
      graph(
        {
          lead: {
            from: "melody",
            use: [{ module: "synth" }, { module: "reverb" }],
            out: [],
          },
          bass: {
            from: "low",
            use: [{ module: "sub" }, { module: "reverb" }],
            out: [],
          },
        },
        ["melody", "low"],
        ["melody"],
      ),
    );
    expect(n["mod:synth"]?.frozen).toBe(true); // only on the frozen chain
    expect(n["mod:reverb"]?.frozen).toBe(false); // shared with a live one
  });

  it("marks it once BOTH sharers are frozen", () => {
    const n = byId(
      graph(
        {
          lead: { from: "melody", use: [{ module: "reverb" }], out: [] },
          bass: { from: "low", use: [{ module: "reverb" }], out: [] },
        },
        ["melody", "low"],
        ["melody", "low"],
      ),
    );
    expect(n["mod:reverb"]?.frozen).toBe(true);
  });

  it("follows chain-feeds-chain, since that chain carries the render too", () => {
    const n = byId(
      graph(
        {
          pre: {
            from: "gtr",
            use: [{ module: "amp" }],
            out: [{ to: "post", gain: 1 }],
          },
          post: { from: "pre", use: [{ module: "cab" }], out: [] },
        },
        ["gtr"],
        ["gtr"],
      ),
    );
    expect(n["mod:amp"]?.frozen).toBe(true);
    expect(n["mod:cab"]?.frozen).toBe(true);
  });

  it("marks nothing when no track is frozen", () => {
    const n = byId(
      graph(
        { lead: { from: "melody", use: [{ module: "synth" }], out: [] } },
        ["melody"],
        [],
      ),
    );
    expect(n["trk:melody"]?.frozen).toBeFalsy();
    expect(n["mod:synth"]?.frozen).toBe(false);
  });

  it("does not mark a BUS, which no single track owns", () => {
    // A bus has no `from`, so nothing freezes it. It is fed by sends from tracks that may each be frozen or not,
    // and it runs as long as any of them plays — which, for a frozen track, its render still does.
    const n = byId(
      graph(
        {
          lead: {
            from: "melody",
            use: [{ module: "synth" }],
            out: [{ to: "verb", gain: 0.3 }],
          },
          verb: { use: [{ module: "reverb" }], out: [{ to: "OUT", gain: 1 }] },
        },
        ["melody"],
        ["melody"],
      ),
    );
    expect(n["mod:synth"]?.frozen).toBe(true);
    expect(n["mod:reverb"]?.frozen).toBe(false);
  });
});
