// A row that ENDS on its lane's mixer hands that card over to be pinned right; any other row is left whole.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { splitTrailingMixer } from "./anchorRight";
import { moduleRow } from "./graph";

const graph = (use: string[]): WebGraph => ({
  chains: {
    lead: {
      from: "gt_lead",
      use: use.map((module) => ({ module })),
      out: [{ to: "MIX", gain: 1 }],
    },
  },
  tracks: ["gt_lead"],
  trackMixers: { gt_lead: "strip" },
  warnings: [],
});

const row = (use: string[]) =>
  moduleRow(graph(use), use, { asDrawn: true, links: true, track: "gt_lead" });

describe("splitTrailingMixer", () => {
  it("lifts the trailing mixer out of the row, bare", () => {
    const split = splitTrailingMixer(row(["amp", "strip"]));
    expect(split?.row.nodes.map((n) => n.module)).toEqual(["gt_lead", "amp"]);
    expect(split?.mixer.nodes).toHaveLength(1);
    expect(split?.mixer.nodes[0]).toMatchObject({
      module: "strip",
      bare: true,
    });
  });

  it("drops every cable that met the mixer, and keeps the others", () => {
    const whole = row(["amp", "strip"]);
    const split = splitTrailingMixer(whole);
    const mixerId = split?.mixer.nodes[0].id;
    expect(
      split?.row.edges.some(
        (e) => e.source === mixerId || e.target === mixerId,
      ),
    ).toBe(false);
    expect(split?.row.edges.length).toBeGreaterThan(0);
    expect(split?.mixer.edges).toEqual([]);
  });

  it("keeps the row's HEIGHT, so one height fit draws both at one scale", () => {
    const whole = row(["amp", "strip"]);
    const split = splitTrailingMixer(whole);
    expect(split?.mixer.height).toBe(whole.height);
    expect(split?.mixer.top).toBe(whole.top);
    expect(split?.mixer.nodes[0].h).toBe(whole.nodes[2].h);
  });

  it("keeps the row's margin, and gives the mixer none so it sits flush right", () => {
    const whole = row(["amp", "strip"]);
    const split = splitTrailingMixer(whole);
    const margin = whole.nodes[0].x;
    const amp = whole.nodes[1];
    const mixer = whole.nodes[2];
    expect(split?.row.width).toBe(amp.x + amp.w + margin);
    expect(split?.mixer.width).toBe(mixer.w);
    expect(split?.mixer.nodes[0].x).toBe(0);
  });

  it("leaves a row alone when its last card is not the mixer", () => {
    expect(splitTrailingMixer(row(["strip", "amp"]))).toBeNull();
  });

  it("leaves a row alone when the mixer is all there is", () => {
    const only = moduleRow(graph(["strip"]), ["strip"], { asDrawn: true });
    expect(splitTrailingMixer(only)).toBeNull();
  });
});
