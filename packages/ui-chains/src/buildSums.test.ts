// buildSums.test.ts — the two sums a build draws, MIX and RENDER, and the runs and devices around them.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { alignModuleRank, buildGraph } from "./graph";

const graph = (
  chains: WebGraph["chains"],
  tracks: string[] = [],
): WebGraph => ({
  chains,
  tracks,
  warnings: [],
});

describe("buildGraph", () => {
  // The mixer's sum is IMPLICIT: what is drawn is the run that leaves it. See docs/graphBuild.md.
  describe("the sum", () => {
    // A song as the scaffolds write one: two lanes into MIX, and the master run declared empty.
    const song = (): WebGraph =>
      graph(
        {
          melody: {
            from: "melody",
            use: [{ module: "lead" }],
            out: [{ to: "MIX", gain: 1 }],
          },
          pad: {
            from: "pad",
            use: [{ module: "synth-pad" }],
            out: [{ to: "MIX", gain: 1 }],
          },
          MIX: { from: "MIX", use: [], out: [{ to: "OUT", gain: 1 }] },
        },
        ["melody", "pad"],
      );

    it("draws no cable from a lane's chain into MIX", () => {
      const { edges } = buildGraph(song());
      expect(edges.filter((e) => e.target === "snk:MIX")).toEqual([]);
      expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
        "snk:MIX->snk:OUT",
        "trk:melody->mod:lead",
        "trk:pad->mod:synth-pad",
      ]);
    });

    // Two cards otherwise: `from: MIX` falls through to the track branch. docs/graphBuild.md.
    it("draws MIX once, as a sink, with the master run leaving it", () => {
      const { nodes } = buildGraph(song());
      expect(nodes.filter((n) => n.label === "MIX").map((n) => n.id)).toEqual([
        "snk:MIX",
      ]);
      expect(nodes.find((n) => n.id === "snk:MIX")?.kind).toBe("sink");
    });

    it("puts the master chain's modules between MIX and OUT", () => {
      const g = song();
      g.chains.MIX = {
        from: "MIX",
        use: [{ module: "comp" }, { module: "eq" }],
        out: [{ to: "OUT", gain: 1 }],
      };
      const { edges } = buildGraph(g);
      expect(
        edges
          .filter((e) => e.source.startsWith("snk:") || e.target === "snk:OUT")
          .map((e) => `${e.source}->${e.target}`)
          .sort(),
      ).toEqual(["mod:eq->snk:OUT", "snk:MIX->mod:comp"]);
    });

    // A sink's rank is the wrong end of the page for a sum: the master run LEAVES it.
    it("ranks the whole master run AFTER every lane, in its own order", () => {
      const g = song();
      g.chains.MIX = {
        from: "MIX",
        use: [{ module: "comp" }],
        out: [{ to: "OUT", gain: 1 }],
      };
      const { nodes } = buildGraph(g);
      const rank = (id: string) => nodes.find((n) => n.id === id)?.rank ?? 0;
      // MIX used to be rank 0 — the track row — leaving its one drawn cable to span the page.
      const lanes = nodes.filter(
        (n) => n.kind === "module" && n.id !== "mod:comp",
      );
      expect(rank("snk:MIX")).toBeGreaterThan(
        Math.max(...lanes.map((n) => n.rank ?? 0)),
      );
      // …and the run keeps its own order inside that: sum, its modules, then the output.
      expect(rank("snk:MIX")).toBeLessThan(rank("mod:comp"));
      expect(rank("mod:comp")).toBeLessThan(rank("snk:OUT"));
    });

    it("does not rank a master module by its place INSIDE the run", () => {
      // `comp` is step 0 of the master chain: ranked by that, it would land up among the lanes.
      const g = song();
      g.chains.MIX = {
        from: "MIX",
        use: [{ module: "comp" }],
        out: [{ to: "OUT", gain: 1 }],
      };
      const { nodes } = buildGraph(g);
      const comp = nodes.find((n) => n.id === "mod:comp");
      const lanes = nodes.filter(
        (n) => n.kind === "module" && n.id !== "mod:comp",
      );
      expect(comp?.rank).toBeGreaterThan(
        Math.max(...lanes.map((n) => n.rank ?? 0)),
      );
    });

    // The mixer view pushes every sink under the strip row, and a SUM keeps the rank it was given.
    it("does not push MIX when the strips are aligned", () => {
      const { nodes } = buildGraph(song());
      const was = nodes.find((n) => n.id === "snk:MIX")?.rank;
      const aligned = alignModuleRank(nodes, ["lead", "synth-pad"]);
      const rank = (id: string) => aligned.find((n) => n.id === id)?.rank;
      expect(rank("snk:MIX")).toBe(was);
      expect(rank("snk:MIX")).toBeLessThan(rank("snk:OUT") ?? 0);
    });

    // Sockets: nothing may ARRIVE at the sum, and the master run leaves by its output.
    it("gives MIX an output socket and no input", () => {
      const { nodes } = buildGraph(song());
      const mix = nodes.find((n) => n.id === "snk:MIX");
      expect(mix?.jacks?.in).toEqual([]);
      expect(mix?.jacks?.out).toHaveLength(1);
      expect(nodes.find((n) => n.id === "snk:OUT")?.jacks?.out).toEqual([]);
    });

    // A project written before `MIX: [ OUT ]` declares no master run, so the pair is drawn anyway.
    it("draws MIX -> OUT even when the file declares no master run", () => {
      const { nodes, edges } = buildGraph(
        graph(
          {
            melody: {
              from: "melody",
              use: [{ module: "lead" }],
              out: [{ to: "MIX", gain: 1 }],
            },
          },
          ["melody"],
        ),
      );
      expect(nodes.find((n) => n.id === "snk:MIX")?.kind).toBe("sink");
      expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
        "snk:MIX->snk:OUT",
        "trk:melody->mod:lead",
      ]);
    });

    // …and a host that wants no OUT card gets none, sum included: half a wire is worse than neither end.
    it("leaves OUT out of that pair when drawMainOut is off", () => {
      const { nodes, edges } = buildGraph(
        graph({
          melody: { use: [{ module: "lead" }], out: [{ to: "MIX", gain: 1 }] },
        }),
        { drawMainOut: false },
      );
      expect(nodes.find((n) => n.id === "snk:OUT")).toBeUndefined();
      expect(edges.filter((e) => e.source === "snk:MIX")).toEqual([]);
    });
  });

  // The PICTURE's pair: the same rules, a different signal, no special case. @studio/song's docs/videoOutputs.md.
  describe("the picture's sum", () => {
    // A video project as the open path leaves one, with the song's own pair beside it.
    const film = (): WebGraph => ({
      ...graph(
        {
          melody: {
            from: "melody",
            use: [{ module: "lead" }],
            out: [{ to: "MIX", gain: 1 }],
          },
          pad: {
            from: "pad",
            use: [{ module: "synth-pad" }],
            out: [{ to: "MIX", gain: 1 }],
          },
          MIX: { from: "MIX", use: [], out: [{ to: "OUT", gain: 1 }] },
          main: {
            from: "main",
            use: [{ module: "grade" }],
            out: [{ to: "RENDER", gain: 1 }],
          },
          pip: {
            from: "pip",
            use: [{ module: "corner" }],
            out: [{ to: "RENDER", gain: 1 }],
          },
          RENDER: {
            from: "RENDER",
            use: [],
            out: [{ to: "VIDEO_OUT", gain: 1 }],
          },
        },
        ["melody", "pad"],
      ),
      videoTracks: ["main", "pip"],
    });

    // The mixer's rule — no cable into the sum — stops at MIX, for the reason docs/graphBuild.md gives.
    it("DRAWS each video chain's cable into RENDER, and still none into MIX", () => {
      const { edges } = buildGraph(film());
      expect(edges.filter((e) => e.target === "snk:MIX")).toEqual([]);
      expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
        "mod:corner->snk:RENDER",
        "mod:grade->snk:RENDER",
        "snk:MIX->snk:OUT",
        "snk:RENDER->snk:VIDEO_OUT",
        "trk:main->mod:grade",
        "trk:melody->mod:lead",
        "trk:pad->mod:synth-pad",
        "trk:pip->mod:corner",
      ]);
    });

    it("draws RENDER once, as a sink, with the video master run leaving it", () => {
      const { nodes } = buildGraph(film());
      expect(
        nodes.filter((n) => n.label === "RENDER").map((n) => n.id),
      ).toEqual(["snk:RENDER"]);
      expect(nodes.find((n) => n.id === "snk:RENDER")?.kind).toBe("sink");
    });

    it("carries PICTURE on the wire out of it", () => {
      // The one thing that differs from the audio pair, and what makes the run read as picture.
      const { edges } = buildGraph(film());
      expect(edges.find((e) => e.source === "snk:RENDER")?.signal).toBe(
        "video",
      );
      expect(edges.find((e) => e.source === "snk:MIX")?.signal).toBe("audio");
    });

    it("puts the video master chain's modules between RENDER and VIDEO_OUT", () => {
      const g = film();
      g.chains.RENDER = {
        from: "RENDER",
        use: [{ module: "blur" }],
        out: [{ to: "VIDEO_OUT", gain: 1 }],
      };
      const { edges } = buildGraph(g);
      expect(
        edges
          .filter(
            (e) => e.source === "snk:RENDER" || e.target === "snk:VIDEO_OUT",
          )
          .map((e) => `${e.source}->${e.target}`)
          .sort(),
      ).toEqual(["mod:blur->snk:VIDEO_OUT", "snk:RENDER->mod:blur"]);
    });

    it("gives VIDEO_OUT no fader — a frame has no level", () => {
      // `OUT` is the one built-in name carrying a param, so the symmetry stops exactly here.
      const { nodes } = buildGraph(film(), { mainOutVolume: -6 });
      expect(nodes.find((n) => n.id === "snk:OUT")?.ui).toBeDefined();
      expect(nodes.find((n) => n.id === "snk:VIDEO_OUT")?.ui).toBeUndefined();
      expect(
        nodes.find((n) => n.id === "snk:VIDEO_OUT")?.params,
      ).toBeUndefined();
    });

    it("does not push RENDER when the strips are aligned", () => {
      const { nodes } = buildGraph(film());
      const was = nodes.find((n) => n.id === "snk:RENDER")?.rank;
      const aligned = alignModuleRank(nodes, ["lead", "synth-pad"]);
      const rank = (id: string) => aligned.find((n) => n.id === id)?.rank;
      expect(rank("snk:RENDER")).toBe(was);
      expect(rank("snk:RENDER")).toBeLessThan(rank("snk:VIDEO_OUT") ?? 0);
    });

    // The editor re-parses on every keystroke, so a half-typed graph must not lose the card.
    it("draws RENDER -> VIDEO_OUT even when the file declares no video master run", () => {
      const g = film();
      delete g.chains.RENDER;
      const { nodes, edges } = buildGraph(g);
      expect(nodes.find((n) => n.id === "snk:RENDER")?.kind).toBe("sink");
      expect(
        edges.some(
          (e) => `${e.source}->${e.target}` === "snk:RENDER->snk:VIDEO_OUT",
        ),
      ).toBe(true);
    });

    it("leaves VIDEO_OUT out of that pair when drawMainOut is off", () => {
      // `drawMainOut` means "do not draw where the signal leaves", picture and sound alike.
      const { nodes, edges } = buildGraph(film(), { drawMainOut: false });
      expect(nodes.find((n) => n.id === "snk:VIDEO_OUT")).toBeUndefined();
      expect(nodes.find((n) => n.id === "snk:OUT")).toBeUndefined();
      expect(edges.filter((e) => e.source === "snk:RENDER")).toEqual([]);
    });

    it("leaves a song with no picture untouched — neither name appears", () => {
      const { nodes } = buildGraph(
        graph(
          {
            melody: {
              from: "melody",
              use: [{ module: "lead" }],
              out: [{ to: "MIX", gain: 1 }],
            },
            MIX: { from: "MIX", use: [], out: [{ to: "OUT", gain: 1 }] },
          },
          ["melody"],
        ),
      );
      expect(nodes.some((n) => n.label === "RENDER")).toBe(false);
      expect(nodes.some((n) => n.label === "VIDEO_OUT")).toBe(false);
    });
  });
});
