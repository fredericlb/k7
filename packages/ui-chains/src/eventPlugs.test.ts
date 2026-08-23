// Event plugs: what a module ANNOUNCES, and what an envelope LISTENS for. The pair is a loop on
// the graph — a note-on out of the instrument's right edge into the curve, the curve's value back
// into the instrument's param — and what is pinned here is that both halves are drawn from the
// same field the compiler bakes from, so the picture cannot claim one source and the sound use
// another.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";

const ENV = { type: "adsr" } as const;
const LFO = { type: "lfo", shape: "sine" } as const;

/** A synth lane whose 4osc has its filter swept by `curve`. */
const graph = (
  curve: { type: "adsr" | "lfo"; shape?: "sine" },
  automation: { param: string; curve: string; trigger?: string } = {
    param: "Filter Freq",
    curve: "env1",
  },
  extra: Record<string, unknown> = {},
): WebGraph =>
  ({
    chains: {
      lead: {
        from: "synth",
        use: [
          {
            module: "osc",
            category: "instruments",
            events: ["note-on"],
            automations: [automation],
            ...extra,
          },
        ],
        out: [{ to: "OUT" }],
      },
    },
    tracks: ["synth"],
    curves: { env1: curve },
    warnings: [],
  }) as unknown as WebGraph;

const nodeOf = (g: WebGraph, id: string) =>
  buildGraph(g).nodes.find((n) => n.id === id);
/** The curve node of the fixture's one binding — its id carries which binding it is. */
const curveNode = (g: WebGraph) =>
  buildGraph(g).nodes.find((n) => n.kind === "curve");

describe("what a module announces", () => {
  it("carries its events onto the node, for the sockets down its right edge", () => {
    expect(nodeOf(graph(ENV), "mod:osc")?.events).toEqual(["note-on"]);
  });

  it("says nothing for a module that announces nothing", () => {
    // Most modules. An absent list is what keeps the field off every node.
    const g = graph(ENV);
    // biome-ignore lint/performance/noDelete: the fixture is testing the ABSENT case
    delete (g.chains.lead.use[0] as { events?: string[] }).events;
    expect(nodeOf(g, "mod:osc")?.events).toBeUndefined();
  });
});

describe("what a curve listens for", () => {
  it("an envelope has an event socket", () => {
    expect(curveNode(graph(ENV))?.eventIn).toBe(true);
  });

  it("a curve of song TIME has none — nothing fires it", () => {
    expect(curveNode(graph(LFO))?.eventIn).toBe(false);
  });
});

describe("a curve nothing binds", () => {
  it("is drawn anyway — a card waiting to be wired", () => {
    // `curve new` has to put something on the graph, or its result is invisible.
    const g = graph(ENV);
    (g as { curves: Record<string, unknown> }).curves.spare = {
      type: "lfo",
      shape: "saw",
    };
    const free = buildGraph(g).nodes.find((n) => n.id === "crv:spare");
    expect(free).toMatchObject({
      kind: "curve",
      label: "spare",
      sub: "lfo saw",
    });
  });

  it("has no binding in its id, which is what tells it from an instance", () => {
    const g = graph(ENV);
    (g as { curves: Record<string, unknown> }).curves.spare = { type: "adsr" };
    const ids = buildGraph(g)
      .nodes.filter((n) => n.kind === "curve")
      .map((n) => n.id);
    expect(ids).toContain("crv:spare"); // free: no binding
    expect(ids.some((i) => i.startsWith("crv:env1@"))).toBe(true); // bound: one
    expect(ids).not.toContain("crv:env1"); // …and never both for one binding
  });

  it("listens too, when it is an envelope", () => {
    const g = graph(ENV);
    (g as { curves: Record<string, unknown> }).curves.spare = { type: "adsr" };
    expect(buildGraph(g).nodes.find((n) => n.id === "crv:spare")?.eventIn).toBe(
      true,
    );
  });
});

describe("several instances of one curve", () => {
  it("gives each binding its own node, fired by its own module", () => {
    // Why one-node-per-curve had to go: one card could not say which instrument fires which.
    const g = graph(ENV);
    g.chains.lead.use.push({
      module: "drums",
      category: "instruments",
      events: ["note-on"],
      automations: [{ param: "Level", curve: "env1", trigger: "drums" }],
    } as never);
    const { nodes, edges } = buildGraph(g);
    const curves = nodes.filter((n) => n.kind === "curve");
    expect(curves).toHaveLength(2);
    // …the same curve, said twice: one file, one label, two nodes.
    expect(curves.map((n) => n.label)).toEqual(["env1", "env1"]);
    expect(new Set(curves.map((n) => n.id)).size).toBe(2);
    // …and each is fired by its own module.
    const fired = edges
      .filter((e) => e.signal === "event")
      .map((e) => e.source)
      .sort();
    expect(fired).toEqual(["mod:drums", "mod:osc"]);
  });
});

describe("the cable that fires it", () => {
  const evEdge = (g: WebGraph) =>
    buildGraph(g).edges.find((e) => e.signal === "event");

  it("runs from the announcing module INTO the curve", () => {
    // The other way round from the automation edge, which leaves the curve for the param.
    const e = evEdge(graph(ENV));
    expect(e).toMatchObject({ source: "mod:osc", sourcePort: "note-on" });
    expect(e?.target).toBe(curveNode(graph(ENV))?.id);
  });

  it("defaults to the module being automated, as the compiler does", () => {
    expect(evEdge(graph(ENV))?.source).toBe("mod:osc");
  });

  it("follows `trigger` when the binding names another module", () => {
    const e = evEdge(
      graph(ENV, { param: "Filter Freq", curve: "env1", trigger: "drums" }),
    );
    expect(e?.source).toBe("mod:drums");
  });

  it("is not drawn for a curve of song time", () => {
    expect(evEdge(graph(LFO))).toBeUndefined();
    // …while the automation edge still is: an LFO drives its param without being fired.
    expect(
      buildGraph(graph(LFO)).edges.some(
        (e) => e.automation?.param === "Filter Freq",
      ),
    ).toBe(true);
  });
});
