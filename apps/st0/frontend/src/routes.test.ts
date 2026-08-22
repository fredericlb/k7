import { describe, expect, it } from "vitest";
import {
  fromLocation,
  type RouteState,
  sameRoute,
  toPath,
  viewPanes,
} from "./routes";

const st = (o: Partial<RouteState> = {}): RouteState => ({
  full: null,
  panel: null,
  help: false,
  builder: null,
  ...o,
});

describe("toPath", () => {
  it("maps the layout and each fullscreen pane", () => {
    expect(toPath(st())).toBe("/");
    expect(toPath(st({ full: "timeline" }))).toBe("/timeline");
    expect(toPath(st({ full: "chains" }))).toBe("/chains");
    expect(toPath(st({ help: true }))).toBe("/docs");
  });

  it("drops the layout once a pane is fullscreened", () => {
    // You are looking at the timeline, not at the layout behind it.
    expect(toPath(st({ full: "timeline" }))).toBe("/timeline");
  });

  it("carries the panel as a query on any screen", () => {
    expect(toPath(st({ panel: "graph" }))).toBe("/?panel=graph");
    expect(toPath(st({ full: "chains", panel: "logs" }))).toBe(
      "/chains?panel=logs",
    );
    // `/docs` is the HELP page and `panel=graph` is a panel — two different things that both
    // used to be spelled "docs" while a Docs panel existed. Only one is left.
    expect(toPath(st({ help: true, panel: "graph" }))).toBe(
      "/docs?panel=graph",
    );
  });

  it("names the desk like any other pane", () => {
    // It was `/surface/desk` — its own kind of address, because a `view` surface was named by
    // FILENAME and the list was the project's. A pane is named by the union.
    expect(toPath(st({ full: "turntables" }))).toBe("/turntables");
    expect(toPath(st({ full: "turntables", panel: "logs" }))).toBe(
      "/turntables?panel=logs",
    );
  });

  it("stacks help over a pane", () => {
    // The URL names the TOPMOST screen, because that is the one you are looking at. Getting
    // this order wrong writes an address that restores something else on reload.
    expect(toPath(st({ help: true, full: "turntables" }))).toBe("/docs");
  });
});

describe("fromLocation", () => {
  it("round-trips every screen", () => {
    for (const s of [
      st(),
      st({ full: "editor" }),
      st({ full: "chains", panel: "graph" }),
      st({ help: true }),
      st({ panel: "logs" }),
    ]) {
      const path = toPath(s);
      const [pathname, search] = path.split("?");
      expect(fromLocation(pathname, search ? `?${search}` : "")).toEqual(s);
    }
  });

  it("round-trips the desk once the project declares it", () => {
    // Not in the loop above: `turntables` needs the flag, exactly as `/viewport` does — the
    // default is deliberately pessimistic for both. See `fromLocation`'s `declared`.
    const s = st({ full: "turntables" });
    expect(fromLocation("/turntables", "", { turntables: true })).toEqual(s);
  });

  it("falls back to the layout on a path it doesn't know", () => {
    // The URL bar is user-editable; a typo should land somewhere usable rather than
    // leaving the shell with no screen at all.
    expect(fromLocation("/nonsense", "")).toEqual(st());
    expect(fromLocation("/", "")).toEqual(st());
  });

  it("ignores a panel it doesn't know", () => {
    expect(fromLocation("/", "?panel=wat").panel).toBeNull();
  });

  it("tolerates trailing and doubled slashes", () => {
    expect(fromLocation("/timeline/", "").full).toBe("timeline");
    // `/video` is an alias for the frame; without one declared it lands on the layout.
    expect(fromLocation("//video//", "")).toEqual(st());
  });

  it("no longer reads a `/surface/<id>` address", () => {
    // The one surface that had a screen of its own is a pane, so the segment names nothing. An
    // old link falls through to the layout, like any other unknown path — which is where
    // `/surface/desk` already landed on a project that had no such file.
    expect(fromLocation("/surface/desk", "")).toEqual(st());
    expect(fromLocation("/surface/", "")).toEqual(st());
    expect(fromLocation("/surface", "")).toEqual(st());
  });
});

describe("viewPanes", () => {
  it("gives the layout its timeline only when the project declares one", () => {
    // The timeline is a `split` surface now, not a pane the shell hands out — so the layout is
    // a function of what the PROJECT says rather than a table. See packages/song/docs/surfaces.md.
    expect(viewPanes({ timeline: true })).toEqual({
      ring: ["timeline", "chains"],
      fullscreen: ["editor", "timeline", "chains"],
    });
    expect(viewPanes({ timeline: false })).toEqual({
      ring: ["chains"],
      fullscreen: ["editor", "chains"],
    });
  });

  it("keeps the editor when the arrangement is missing", () => {
    // A project with no timeline surface is one that has not declared an arrangement, and its
    // files are still what you are there to edit. `live` used to fullscreen NOTHING here, on
    // the grounds that its single pane already had the window; that layout went with the mode,
    // and this is the half of the pair that leaves you somewhere to work.
    expect(viewPanes({ timeline: false }).fullscreen).toContain("editor");
    expect(viewPanes({ timeline: false }).ring).toEqual(["chains"]);
  });

  it("refuses `/timeline` as an address when there is no timeline", () => {
    // The same rule that already refuses it in a live project: an address must not parse into a
    // pane nothing will mount.
    expect(fromLocation("/timeline", "", { timeline: true }).full).toBe(
      "timeline",
    );
    expect(fromLocation("/timeline", "", { timeline: false })).toEqual(st());
  });

  it("puts the FRAME above the arrangement when the project declares one", () => {
    // The ring is read by the number keys and the mobile tabs, so its order is the order the
    // panes are stacked on screen — frame, arrangement, desk, graph.
    expect(viewPanes({ timeline: true, viewport: true })).toEqual({
      ring: ["viewport", "timeline", "chains"],
      fullscreen: ["editor", "viewport", "timeline", "chains"],
    });
    // Picture with no arrangement: a cut that is all shots and no lanes is a real song folder.
    expect(viewPanes({ timeline: false, viewport: true })).toEqual({
      ring: ["viewport", "chains"],
      fullscreen: ["editor", "viewport", "chains"],
    });
  });

  it("puts the DESK directly over the graph", () => {
    // A SET: no arrangement, a desk and the chains it is played against. Those two are the
    // whole column, which is the point of the desk being a pane rather than a screen over it.
    expect(viewPanes({ timeline: false, turntables: true })).toEqual({
      ring: ["turntables", "chains"],
      fullscreen: ["editor", "turntables", "chains"],
    });
    // …and under the arrangement when a project somehow declares both, since the ring is the
    // stacking order and the desk sits nearest the graph.
    expect(
      viewPanes({ timeline: true, viewport: true, turntables: true }).ring,
    ).toEqual(["viewport", "timeline", "turntables", "chains"]);
  });

  it("refuses `/turntables` as an address when there is no desk", () => {
    expect(fromLocation("/turntables", "", { turntables: true }).full).toBe(
      "turntables",
    );
    expect(fromLocation("/turntables", "", { turntables: false })).toEqual(
      st(),
    );
    // …and NOT by the optimistic default the timeline gets: a desk is the exception, so an
    // ordinary song must never parse this address on the frame before the surfaces land.
    expect(fromLocation("/turntables", "")).toEqual(st());
  });

  it("drops the editor from a FROZEN layout, and from its addresses", () => {
    // A shared snapshot has no source at all — no /tree and no /file — so the editor is not a
    // pane whose document is read-only, it is a pane with nothing behind it. Dropped in the one
    // list the number keys, the mobile tabs, `ui editor` and every address all read.
    expect(viewPanes({ timeline: true, frozen: true })).toEqual({
      ring: ["timeline", "chains"],
      fullscreen: ["timeline", "chains"],
    });
    expect(fromLocation("/editor", "", { timeline: true }).full).toBe("editor");
    expect(
      fromLocation("/editor", "", { timeline: true, frozen: true }),
    ).toEqual(st());
    // …and the panes it DOES have are untouched: frozen is about the source, not the song.
    expect(
      fromLocation("/timeline", "", { timeline: true, frozen: true }).full,
    ).toBe("timeline");
  });

  it("refuses `/viewport` as an address when there is no picture", () => {
    expect(fromLocation("/viewport", "", { viewport: true }).full).toBe(
      "viewport",
    );
    expect(fromLocation("/viewport", "", { viewport: false })).toEqual(st());
  });

  it("lands an old `/video` bookmark on the frame", () => {
    // It was the picture pane's address for a year. Subject to the same check as any other, so
    // a song without picture still falls through to its layout rather than to a dead pane.
    expect(fromLocation("/video", "", { viewport: true }).full).toBe(
      "viewport",
    );
    expect(fromLocation("/video", "", { viewport: false })).toEqual(st());
  });
});

describe("sameRoute", () => {
  it("is true only when the URL would be identical", () => {
    expect(sameRoute(st({ full: "editor" }), st({ full: "editor" }))).toBe(
      true,
    );
    expect(sameRoute(st({ panel: "graph" }), st({ panel: "logs" }))).toBe(
      false,
    );
  });
});
