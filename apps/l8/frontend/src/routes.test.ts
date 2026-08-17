import { describe, expect, it } from "vitest";
import {
  fromLocation,
  type RouteState,
  sameRoute,
  toPath,
  viewPanes,
} from "./routes";

const st = (o: Partial<RouteState> = {}): RouteState => ({
  view: "global",
  full: null,
  panel: null,
  help: false,
  surface: null,
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

  it("names an open surface", () => {
    expect(toPath(st({ surface: "desk" }))).toBe("/surface/desk");
    expect(toPath(st({ surface: "desk", panel: "logs" }))).toBe(
      "/surface/desk?panel=logs",
    );
  });

  it("stacks help over a surface over a pane", () => {
    // The URL names the TOPMOST screen, because that is the one you are looking at. Getting
    // this order wrong writes an address that restores something else on reload.
    expect(toPath(st({ surface: "desk", full: "timeline" }))).toBe(
      "/surface/desk",
    );
    expect(toPath(st({ help: true, surface: "desk" }))).toBe("/docs");
  });

  it("escapes a surface id that needs it", () => {
    expect(toPath(st({ surface: "a b" }))).toBe("/surface/a%20b");
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
      st({ surface: "desk" }),
      st({ surface: "a b", panel: "graph" }),
    ]) {
      const path = toPath(s);
      const [pathname, search] = path.split("?");
      expect(
        fromLocation(pathname, search ? `?${search}` : "", s.view),
      ).toEqual(s);
    }
  });

  it("keeps the current layout under a fullscreen pane", () => {
    // The path must not force `view`: with one layout that is invisible, and the rule is the
    // routing's rather than the layout list's — a second layout would rely on it again.
    expect(fromLocation("/timeline", "", "global").view).toBe("global");
  });

  it("falls back to the global view on a path it doesn't know", () => {
    // The URL bar is user-editable; a typo should land somewhere usable rather than
    // leaving the shell with no screen at all.
    expect(fromLocation("/nonsense", "", "global")).toEqual(st());
    expect(fromLocation("/", "", "global")).toEqual(st());
  });

  it("ignores a panel it doesn't know", () => {
    expect(fromLocation("/", "?panel=wat", "global").panel).toBeNull();
  });

  it("tolerates trailing and doubled slashes", () => {
    expect(fromLocation("/timeline/", "", "global").full).toBe("timeline");
    // `/video` is an alias for the frame; without one declared it lands on the layout.
    expect(fromLocation("//video//", "", "global")).toEqual(st());
  });

  it("reads a surface id WITHOUT checking it exists", () => {
    // Deliberate: the project's surfaces arrive a moment after the shell does, so an address
    // that was validated here would parse to "no surface" on every deep link and quietly drop
    // you on the layout. The screen resolves it once the list lands, and says so if there is
    // no such file.
    expect(fromLocation("/surface/desk", "", "global").surface).toBe("desk");
    expect(fromLocation("/surface/nope", "", "global").surface).toBe("nope");
    expect(fromLocation("/surface/a%20b", "", "global").surface).toBe("a b");
  });

  it("is not a surface without an id", () => {
    expect(fromLocation("/surface/", "", "global")).toEqual(st());
    expect(fromLocation("/surface", "", "global")).toEqual(st());
  });

  it("keeps a hand-typed % that is not an escape", () => {
    // Same rule `parseLaunch` follows: keep it rather than throwing on an address someone typed.
    expect(fromLocation("/surface/100%", "", "global").surface).toBe("100%");
  });
});

describe("viewPanes", () => {
  it("gives `global` its timeline only when the project declares one", () => {
    // The timeline is a `split` surface now, not a pane the shell hands out — so the layout is
    // a function of what the PROJECT says rather than a table. See packages/song/docs/surfaces.md.
    expect(viewPanes("global", true)).toEqual({
      ring: ["timeline", "chains"],
      fullscreen: ["editor", "timeline", "chains"],
    });
    expect(viewPanes("global", false)).toEqual({
      ring: ["chains"],
      fullscreen: ["editor", "chains"],
    });
  });

  it("keeps the editor when the arrangement is missing, and drops it in `live`", () => {
    // The two look alike on screen and are not the same fact: a song with no timeline surface is
    // a song that has not declared one, and its files are still what you are there to edit. A
    // rig fullscreens nothing at all — its one pane already has the window.
    expect(viewPanes("global", false).fullscreen).toContain("editor");
    expect(viewPanes("live", true)).toEqual({
      ring: ["chains"],
      fullscreen: [],
    });
    expect(viewPanes("live", false).fullscreen).toEqual([]);
  });

  it("refuses `/timeline` as an address when there is no timeline", () => {
    // The same rule that already refuses it in a live project: an address must not parse into a
    // pane nothing will mount.
    expect(fromLocation("/timeline", "", "global", true).full).toBe("timeline");
    expect(fromLocation("/timeline", "", "global", false)).toEqual(st());
    expect(fromLocation("/timeline", "", "live", true)).toEqual(
      st({ view: "live" }),
    );
  });

  it("puts the FRAME above the arrangement when the project declares one", () => {
    // The ring is read by the number keys and the mobile tabs, so its order is the order the
    // panes are stacked on screen — frame, arrangement, graph.
    expect(viewPanes("global", true, true)).toEqual({
      ring: ["viewport", "timeline", "chains"],
      fullscreen: ["editor", "viewport", "timeline", "chains"],
    });
    // Picture with no arrangement: a cut that is all shots and no lanes is a real song folder.
    expect(viewPanes("global", false, true)).toEqual({
      ring: ["viewport", "chains"],
      fullscreen: ["editor", "viewport", "chains"],
    });
  });

  it("gives a RIG its fullscreens back once it declares a viewport", () => {
    // `live`'s empty fullscreen list is about having ONE pane, not about being a rig — a rig
    // with picture has two, and hiding either behind no address would be the blank screen.
    expect(viewPanes("live", true, true)).toEqual({
      ring: ["viewport", "chains"],
      fullscreen: ["viewport", "chains"],
    });
    // …and the editor stays out of a live layout, as it always has: `ui file` is a popin.
    expect(viewPanes("live", true, true).fullscreen).not.toContain("editor");
  });

  it("drops the editor from a FROZEN layout, and from its addresses", () => {
    // A shared snapshot has no source at all — no /tree and no /file — so the editor is not a
    // pane whose document is read-only, it is a pane with nothing behind it. Dropped in the one
    // list the number keys, the mobile tabs, `ui editor` and every address all read.
    expect(viewPanes("global", true, false, true)).toEqual({
      ring: ["timeline", "chains"],
      fullscreen: ["timeline", "chains"],
    });
    expect(fromLocation("/editor", "", "global", true, false, false).full).toBe(
      "editor",
    );
    expect(fromLocation("/editor", "", "global", true, false, true)).toEqual(
      st(),
    );
    // …and the panes it DOES have are untouched: frozen is about the source, not the song.
    expect(
      fromLocation("/timeline", "", "global", true, false, true).full,
    ).toBe("timeline");
  });

  it("refuses `/viewport` as an address when there is no picture", () => {
    expect(fromLocation("/viewport", "", "global", true, true).full).toBe(
      "viewport",
    );
    expect(fromLocation("/viewport", "", "global", true, false)).toEqual(st());
  });

  it("lands an old `/video` bookmark on the frame", () => {
    // It was the picture pane's address for a year. Subject to the same check as any other, so
    // a song without picture still falls through to its layout rather than to a dead pane.
    expect(fromLocation("/video", "", "global", true, true).full).toBe(
      "viewport",
    );
    expect(fromLocation("/video", "", "global", true, false)).toEqual(st());
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
