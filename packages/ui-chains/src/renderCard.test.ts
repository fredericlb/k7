// The RENDER sink carries the FRAME's shape. What is pinned here is that it carries it whichever
// way the sink came to exist — the bug this test was written for is that it had THREE creation
// sites and the card was applied at one of them, the one most projects with a picture skip.

import { describe, expect, it } from "vitest";
import { buildGraph, RENDER_OUT, RENDER_UI } from "./graph";

const SINK = `snk:${RENDER_OUT}`;

/** A picture project: one camera lane into the sum, and NO master run of its own. */
const implicit = {
  chains: { cam: { from: "camlane", use: [], out: [{ to: "RENDER" }] } },
  modules: {},
  tracks: [],
  videoTracks: ["camlane"],
  trackSignals: { camlane: "video" },
  assemblies: {},
} as never;

/** …and the same project once it DECLARES its master run — `RENDER: [ VIDEO_OUT ]`. */
const declared = {
  chains: {
    cam: { from: "camlane", use: [], out: [{ to: "RENDER" }] },
    RENDER: { from: "RENDER", use: [], out: [{ to: "VIDEO_OUT" }] },
  },
  modules: {},
  tracks: [],
  videoTracks: ["camlane"],
  trackSignals: { camlane: "video" },
  assemblies: {},
} as never;

const cardOf = (g: never, opts: Record<string, unknown>) =>
  buildGraph(g, { drawMainOut: true, ...opts }).nodes.find(
    (n) => n.id === SINK,
  );

describe("the RENDER card", () => {
  it("wears the frame dropdown when the host says the shape", () => {
    const card = cardOf(implicit, { aspect: 1 });
    expect(card?.ui).toEqual(RENDER_UI);
    expect(card?.aspect).toBe(1);
    expect(card?.module).toBe(RENDER_OUT);
  });

  it("wears it on a project that DECLARES its own master run", () => {
    // The sums loop is skipped for a sum that is also a chain, which is what a declared
    // `RENDER: [ VIDEO_OUT ]` makes it — and that is most projects with a picture.
    const card = cardOf(declared, { aspect: 0 });
    expect(card?.ui).toEqual(RENDER_UI);
    expect(card?.aspect).toBe(0);
  });

  it("wears none when the host says nothing — a project with no picture", () => {
    expect(cardOf(implicit, {})?.ui).toBeFalsy();
    expect(cardOf(declared, {})?.ui).toBeFalsy();
  });

  it("offers exactly the two shapes, as a dropdown", () => {
    const w = RENDER_UI.widgets.aspect;
    expect(w.type).toBe("dropdown");
    expect(w.bind).toBe("@project:aspect");
    expect(w.options?.map((o) => o.label)).toEqual(["16:9", "9:16"]);
    // The option VALUES are the row indices `renderCard` puts on the node, or the menu ticks
    // the wrong row — the two are the same number by construction, so say so.
    expect(w.options?.map((o) => o.value)).toEqual([0, 1]);
  });
});
